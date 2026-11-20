// Names from what devices announce about themselves on the local network:
//  - mDNS / DNS-SD (Apple devices, Chromecasts and smart TVs, printers, smart-home hubs, Linux machines)
//  - NetBIOS (Windows PCs, NAS drives, routers with file sharing)
// Both are questions every device on a home network is built to answer. Nothing is logged into.
import dgram from "node:dgram";

// ---------- DNS message encoding / decoding (RFC 1035, with name compression) ----------
export function encodeQuery(questions, id = 0) {
  const parts = [Buffer.from([id >> 8, id & 255, 0, 0, 0, questions.length, 0, 0, 0, 0, 0, 0])];
  for (const { name, type } of questions) {
    for (const label of name.split(".").filter(Boolean)) {
      const b = Buffer.from(label, "utf8");
      parts.push(Buffer.from([b.length]), b);
    }
    parts.push(Buffer.from([0, type >> 8, type & 255, 0, 1])); // class IN
  }
  return Buffer.concat(parts);
}

function readName(buf, off) {
  const labels = [];
  let jumped = false;
  let next = off;
  for (let guard = 0; guard < 128 && off < buf.length; guard++) {
    const len = buf[off];
    if (len === 0) { if (!jumped) next = off + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumped = true;
      continue;
    }
    labels.push(buf.subarray(off + 1, off + 1 + len).toString("utf8"));
    off += 1 + len;
  }
  return { name: labels.join("."), next };
}

export const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, AAAA: 28, ANY: 255 };

export function decodeMessage(buf) {
  if (buf.length < 12) return null;
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) { off = readName(buf, off).next + 4; }
  const records = [];
  for (let i = 0; i < total && off + 10 <= buf.length; i++) {
    const { name, next } = readName(buf, off);
    off = next;
    const type = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 8);
    const start = off + 10;
    off = start + len;
    if (off > buf.length) break;
    const r = { name, type };
    if (type === TYPE.A && len === 4) r.data = [...buf.subarray(start, start + 4)].join(".");
    else if (type === TYPE.PTR) r.data = readName(buf, start).name;
    else if (type === TYPE.SRV) r.data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6).name };
    else if (type === TYPE.TXT) {
      const txt = {};
      for (let p = start; p < start + len; ) {
        const l = buf[p];
        const s = buf.subarray(p + 1, p + 1 + l).toString("utf8");
        const eq = s.indexOf("=");
        if (eq > 0) txt[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
        p += 1 + l;
      }
      r.data = txt;
    } else continue;
    records.push(r);
  }
  return records;
}

// ---------- What a service type says about the device ----------
export const SERVICES = {
  "_googlecast._tcp.local": "TV or streaming device",
  "_airplay._tcp.local": "TV or streaming device",
  "_raop._tcp.local": "speaker or TV",
  "_spotify-connect._tcp.local": "speaker or TV",
  "_ipp._tcp.local": "printer",
  "_ipps._tcp.local": "printer",
  "_printer._tcp.local": "printer",
  "_pdl-datastream._tcp.local": "printer",
  "_hap._tcp.local": "smart-home device",
  "_matter._tcp.local": "smart-home device",
  "_companion-link._tcp.local": "Apple device",
  "_device-info._tcp.local": null,
  "_smb._tcp.local": "computer",
  "_workstation._tcp.local": "computer",
  "_ssh._tcp.local": "computer",
  "_http._tcp.local": null,
};

// Apple publishes its model in _device-info TXT ("model=iPhone14,2", "model=MacBookAir10,1").
function appleKind(model = "") {
  if (/^iPhone/i.test(model)) return "phone or tablet";
  if (/^iPad/i.test(model)) return "phone or tablet";
  if (/^(Mac|iMac)/i.test(model)) return "computer";
  if (/^AppleTV/i.test(model)) return "TV or streaming device";
  if (/^AudioAccessory/i.test(model)) return "speaker or TV";
  return null;
}

const cleanInstance = (s) => s.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(Number(d))).replace(/\\(.)/g, "$1");

// Collapses mDNS records into { ip -> { name, kind, model, services } }.
export function summarizeMdns(records) {
  const ipOfHost = new Map();
  const byInstance = new Map(); // "Living Room._googlecast._tcp.local" -> { service, host, txt }
  for (const r of records) {
    if (r.type === TYPE.A) ipOfHost.set(r.name.toLowerCase(), r.data);
  }
  for (const r of records) {
    if (r.type === TYPE.PTR && SERVICES[r.name] !== undefined) {
      const inst = byInstance.get(r.data) || {};
      byInstance.set(r.data, { ...inst, service: r.name });
    } else if (r.type === TYPE.SRV) {
      const inst = byInstance.get(r.name) || {};
      byInstance.set(r.name, { ...inst, host: r.data.target.toLowerCase(), port: r.data.port, service: inst.service || r.name.split(".").slice(-3).join(".") });
    } else if (r.type === TYPE.TXT) {
      const inst = byInstance.get(r.name) || {};
      byInstance.set(r.name, { ...inst, txt: { ...(inst.txt || {}), ...r.data } });
    }
  }
  const out = {};
  for (const [instance, info] of byInstance) {
    let ip = info.host && ipOfHost.get(info.host);
    // _device-info has no SRV: match it to a host of the same instance name
    if (!ip && /_device-info\._tcp\.local$/.test(instance)) {
      const bare = instance.replace(/\._device-info\._tcp\.local$/, "").toLowerCase();
      ip = ipOfHost.get(`${bare}.local`);
      if (!ip) for (const [inst2, i2] of byInstance) if (inst2.toLowerCase().startsWith(`${bare}.`) && i2.host) ip = ipOfHost.get(i2.host) || ip;
    }
    if (!ip) continue;
    const label = cleanInstance(instance.slice(0, instance.length - (info.service || "").length - 1) || instance);
    const d = (out[ip] ||= { name: null, kind: null, model: null, services: [] });
    if (info.service && !d.services.includes(info.service)) d.services.push(info.service);
    const txt = info.txt || {};
    const friendly = txt.fn || txt.n || null; // Chromecast "fn", HomeKit "n"? (HomeKit uses the instance name)
    if (!/_device-info\._tcp/.test(instance) && (friendly || label) && !d.name) d.name = (friendly || label).slice(0, 60);
    if (txt.md && !d.model) d.model = txt.md.slice(0, 60); // Chromecast / HomeKit model
    if (txt.model && !d.model) d.model = txt.model.slice(0, 60);
    if (txt.ty && !d.model) d.model = txt.ty.slice(0, 60); // printers
    const kind = SERVICES[info.service] || appleKind(txt.model);
    if (kind && (!d.kind || d.kind === "Apple device" || d.kind === "computer")) d.kind = kind;
  }
  for (const [host, ip] of ipOfHost) {
    const d = (out[ip] ||= { name: null, kind: null, model: null, services: [] });
    d.host = d.host || host.replace(/\.local$/, "");
  }
  return out;
}

// Asks, from an ordinary port, which devices offer common home services. Devices reply directly to us
// ("legacy unicast", RFC 6762 section 6.7), so this works without taking over port 5353.
export function queryMdns(localAddress = null, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const records = [];
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => { try { sock.close(); } catch {} resolve(records); };
    sock.on("message", (msg) => { const r = decodeMessage(msg); if (r) records.push(...r); });
    sock.on("error", finish);
    sock.bind(0, () => {
      // Send on the home network's interface, not a VPN or virtual-machine adapter.
      if (localAddress) try { sock.setMulticastInterface(localAddress); } catch {}
      const types = Object.keys(SERVICES);
      // Two packets keep each question list small.
      for (const chunk of [types.slice(0, 8), types.slice(8)]) {
        sock.send(encodeQuery(chunk.map((name) => ({ name, type: TYPE.PTR })), 0x5054), 5353, "224.0.0.251");
      }
      sock.send(encodeQuery([{ name: "_services._dns-sd._udp.local", type: TYPE.PTR }], 0x5055), 5353, "224.0.0.251");
    });
    setTimeout(finish, timeoutMs);
  });
}

// Reverse lookup sent straight to one device: "what is your name?" (works on Apple devices, Linux, Windows 10+).
export function reverseMdns(ip, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const name = ip.split(".").reverse().join(".") + ".in-addr.arpa";
    const finish = (v) => { try { sock.close(); } catch {} resolve(v); };
    sock.on("message", (msg) => {
      const ptr = (decodeMessage(msg) || []).find((r) => r.type === TYPE.PTR && r.name === name);
      if (ptr) finish(ptr.data.replace(/\.local$/, ""));
    });
    sock.on("error", () => finish(null));
    sock.bind(0, () => sock.send(encodeQuery([{ name, type: TYPE.PTR }], 0x5056), 5353, ip));
    setTimeout(() => finish(null), timeoutMs);
  });
}

// ---------- NetBIOS node status (UDP 137): the names a Windows PC or NAS gives itself ----------
export const NBSTAT_QUERY = Buffer.from(
  "50430000000100000000000020434b4141414141414141414141414141414141414141414141414141414141410000210001",
  "hex"
);

export function parseNbstat(buf) {
  if (buf.length < 57) return null;
  let off = 12;
  while (off < buf.length && buf[off] !== 0) off += buf[off] + 1; // skip the name
  off += 1 + 2 + 2 + 4 + 2; // null, type, class, ttl, rdlength
  const count = buf[off];
  off += 1;
  const names = [];
  for (let i = 0; i < count && off + 18 <= buf.length; i++, off += 18) {
    const name = buf.subarray(off, off + 15).toString("latin1").trimEnd();
    const suffix = buf[off + 15];
    const group = Boolean(buf[off + 16] & 0x80);
    names.push({ name, suffix, group });
  }
  const host = names.find((n) => n.suffix === 0x00 && !n.group) || names.find((n) => n.suffix === 0x20);
  const fileSharing = names.some((n) => n.suffix === 0x20);
  return host ? { name: host.name, fileSharing } : null;
}

export function netbiosName(ip, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const finish = (v) => { try { sock.close(); } catch {} resolve(v); };
    sock.on("message", (msg) => finish(parseNbstat(msg)));
    sock.on("error", () => finish(null));
    sock.bind(0, () => sock.send(NBSTAT_QUERY, 137, ip));
    setTimeout(() => finish(null), timeoutMs);
  });
}

// A MAC address with the "locally administered" bit set is a private, randomised address: phones, tablets and
// laptops use them on Wi-Fi so they can't be tracked between networks.
export const isPrivateMac = (mac = "") => /^[0-9a-f]{2}:/i.test(mac) && (parseInt(mac.slice(0, 2), 16) & 0b11) === 0b10;
