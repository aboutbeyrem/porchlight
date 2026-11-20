// UPnP: lets devices describe themselves ("Living room TV", "Hikvision camera") and lets us ask the router which
// doors devices have opened to the internet on their own. Read-only: it lists port mappings, never adds or removes one.
import dgram from "node:dgram";
import { httpRequest, xmlTag } from "./http.js";

export function parseSsdpResponse(text) {
  const headers = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

export function searchSsdp(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map(); // location -> { ip, location, server }
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("message", (msg, rinfo) => {
      const h = parseSsdpResponse(msg.toString("utf8"));
      if (h.location && !found.has(h.location)) found.set(h.location, { ip: rinfo.address, location: h.location, server: h.server || null });
    });
    sock.on("error", () => {
      try { sock.close(); } catch {}
      resolve([...found.values()]);
    });
    sock.bind(0, () => {
      const search = ["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"', "MX: 2", "ST: ssdp:all", "", ""].join("\r\n");
      sock.send(search, 1900, "239.255.255.250");
      setTimeout(() => sock.send(search, 1900, "239.255.255.250"), 500);
    });
    setTimeout(() => {
      try { sock.close(); } catch {}
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export function parseDescription(xml, location) {
  const base = xmlTag(xml, "URLBase") || location;
  const services = [];
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const type = xmlTag(m[1], "serviceType");
    const control = xmlTag(m[1], "controlURL");
    if (type && control) services.push({ type, controlUrl: new URL(control, base).toString() });
  }
  return {
    friendlyName: xmlTag(xml, "friendlyName"),
    manufacturer: xmlTag(xml, "manufacturer"),
    modelName: xmlTag(xml, "modelName"),
    deviceType: xmlTag(xml, "deviceType"),
    services,
  };
}

export function parseMapping(xml) {
  const get = (t) => xmlTag(xml, t);
  if (!get("NewExternalPort")) return null;
  return {
    externalPort: Number(get("NewExternalPort")),
    protocol: get("NewProtocol"),
    internalClient: get("NewInternalClient"),
    internalPort: Number(get("NewInternalPort")),
    enabled: get("NewEnabled") !== "0",
    description: get("NewPortMappingDescription") || "",
  };
}

async function listMappings(service) {
  const mappings = [];
  for (let i = 0; i < 64; i++) {
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetGenericPortMappingEntry xmlns:u="${service.type}"><NewPortMappingIndex>${i}</NewPortMappingIndex></u:GetGenericPortMappingEntry></s:Body></s:Envelope>`;
    const res = await httpRequest(service.controlUrl, {
      method: "POST",
      body,
      headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#GetGenericPortMappingEntry"` },
    });
    if (!res || res.status !== 200) break; // 500 with error 713 = no more entries
    const m = parseMapping(res.body);
    if (!m) break;
    mappings.push(m);
  }
  return mappings;
}

// Returns { devices: [{ip, friendlyName, manufacturer, modelName}], router: { found, mappings } }
export async function upnpSurvey() {
  const responders = await searchSsdp();
  const devices = [];
  const router = { found: false, mappings: [] };
  for (const r of responders) {
    const res = await httpRequest(r.location);
    if (!res || res.status !== 200) continue;
    const d = parseDescription(res.body, r.location);
    devices.push({ ip: r.ip, friendlyName: d.friendlyName, manufacturer: d.manufacturer, modelName: d.modelName });
    const wan = d.services.find((s) => /WAN(IP|PPP)Connection/.test(s.type));
    if (wan && !router.found) {
      router.found = true;
      router.ip = r.ip;
      router.mappings = await listMappings(wan);
    }
  }
  return { devices, router };
}
