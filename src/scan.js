// Runs the whole checkup in order and reports progress. Every step is read-only.
import { findNetwork } from "./network.js";
import { discover } from "./discover.js";
import { scanPorts, pool, COMMON_PORTS } from "./ports.js";
import { checkRtsp } from "./rtsp.js";
import { upnpSurvey } from "./ssdp.js";
import { checkRouterAdmin } from "./router.js";
import { wifiSurvey, sameHardware } from "./wifi.js";
import { webIdentity, readBanner, ftpSoftware, vendorOf } from "./identify.js";
import { queryMdns, summarizeMdns, reverseMdns, netbiosName } from "./mdns.js";
import { firewallStatus } from "./system.js";
import { loadHistory, saveHistory, networkKey, compare, updateEntry } from "./history.js";
import { buildFindings, changeFindings, summarize, scoreOf, deviceName, deviceKind, ownNetworks, LEVELS } from "./findings.js";

export async function runCheckup({ homeSsid = null, onProgress = () => {}, history = true } = {}) {
  const started = new Date();
  onProgress("Finding your network");
  const net = await findNetwork();
  if (!net) throw new Error("This computer doesn't seem to be connected to a network.");

  onProgress("Looking for devices on your network");
  const devices = await discover(net);

  // The Wi-Fi survey only listens, so it runs while everything else happens.
  const wifiPromise = wifiSurvey();

  onProgress("Asking devices to describe themselves");
  const [upnp, mdnsRecords] = await Promise.all([upnpSurvey(net.address), queryMdns(net.address)]);
  const mdns = summarizeMdns(mdnsRecords);
  for (const u of upnp.devices) {
    const d = devices.find((x) => x.ip === u.ip);
    if (d && !d.friendlyName) Object.assign(d, { friendlyName: u.friendlyName, manufacturer: u.manufacturer, modelName: u.modelName });
  }
  await pool(devices.filter((d) => !d.self), 8, async (d) => {
    const [nb, rev] = await Promise.all([netbiosName(d.ip), mdns[d.ip]?.name ? null : reverseMdns(d.ip)]);
    if (mdns[d.ip]) d.mdns = mdns[d.ip];
    if (rev) d.mdns = { ...(d.mdns || { kind: null, model: null, services: [] }), host: rev };
    if (nb) d.netbios = nb;
    d.vendor = vendorOf(d.mac);
  });

  onProgress(`Checking ${devices.length} devices for open doors`);
  await pool(devices, 8, async (d) => {
    d.ports = await scanPorts(d.ip);
    const rtspPort = [554, 8554].find((p) => d.ports.includes(p));
    if (rtspPort && !d.self) d.rtsp = { ...(await checkRtsp(d.ip, rtspPort)), port: rtspPort };
    if (!d.self) d.web = await webIdentity(d.ip, d.ports);
    if (d.ports.includes(21)) d.ftp = ftpSoftware(await readBanner(d.ip, 21));
  });

  // Cheap Wi-Fi repeaters give every device connected through them the repeater's own MAC address. When several
  // addresses share one MAC, the one that answers (its settings page, open ports) is the repeater; the rest are
  // devices connected through it.
  const byMac = new Map();
  for (const d of devices) if (d.mac && !d.self && !d.isRouter) byMac.set(d.mac, [...(byMac.get(d.mac) || []), d]);
  for (const group of byMac.values()) {
    if (group.length < 2) continue;
    const host = group.find((d) => d.web?.label) || group.find((d) => d.ports?.length) || group[0];
    for (const d of group) {
      d.sharedMac = true;
      if (d !== host) d.behind = host.ip;
    }
  }

  onProgress("Looking at your router's settings page");
  const [routerAdmin, firewall] = await Promise.all([checkRouterAdmin(net.gateway), firewallStatus()]);

  onProgress("Checking your Wi-Fi and adapters");
  const wifi = await wifiPromise;
  for (const d of devices) {
    if (d.self || !d.mac || d.behind) continue;
    const b = [...new Set(wifi.aps.filter((a) => sameHardware(d.mac, a.bssid)).map((a) => a.ssid).filter(Boolean))];
    if (b.length) d.broadcasts = b;
  }

  const findings = buildFindings({ devices, upnp, routerAdmin, wifi, homeSsid, firewall });

  // What changed since last time (stored on this computer only).
  let changes = null;
  if (history) {
    const h = loadHistory();
    const key = networkKey(net, devices);
    const heard = new Set([...wifi.aps.map((a) => a.ssid), ...wifi.networks.map((n) => n.ssid), ...wifi.adapters.map((a) => a.ssid)].filter(Boolean));
    changes = compare(h.networks[key], devices, findings, heard);
    findings.push(...changeFindings(changes));
    h.networks[key] = updateEntry(h.networks[key], devices, findings, started.toISOString(), deviceName, changes.unverified);
    saveHistory(h);
  }
  findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));

  return {
    when: started.toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    network: { cidr: net.cidr, gateway: net.gateway, address: net.address, interface: net.interface, narrowed: net.narrowed },
    homeSsid,
    score: scoreOf(findings),
    changes: changes && { firstRun: changes.firstRun, since: changes.since, newDevices: changes.newDevices.map((d) => d.ip), fixed: changes.fixed.map((p) => p.title) },
    devices: devices.map((d) => ({
      ip: d.ip,
      name: deviceName(d),
      kind: deviceKind(d),
      vendor: d.vendor || null,
      ports: d.ports || [],
      doors: (d.ports || []).map((p) => ({ port: p, name: COMMON_PORTS[p]?.name || String(p), plain: COMMON_PORTS[p]?.plain || `port ${p}` })),
      mac: d.mac || "",
      self: Boolean(d.self),
      isRouter: Boolean(d.isRouter),
      web: d.web?.url || null,
      broadcasts: d.broadcasts || [],
      isNew: Boolean(changes?.newDevices.includes(d)),
    })),
    wifi: {
      adapters: wifi.adapters,
      networks: wifi.networks.map((n) => n.ssid),
      yours: ownNetworks({ wifi, homeSsid, devices }).map((n) => ({ ssid: n.ssid, reason: n.reason, auth: n.auth || null, wps: n.aps.length ? n.aps.some((a) => a.wps) : null, device: n.device?.ip || null })),
      wpsCheckable: wifi.wpsCheckable,
    },
    upnp: { routerFound: upnp.router.found, mappings: upnp.router.mappings },
    summary: summarize(findings),
    findings,
  };
}
