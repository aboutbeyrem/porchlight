// Wi-Fi: which adapters this computer has, whether they can do (or are in) monitor mode, and how well the home
// Wi-Fi is protected. Read-only: it reads what the operating system already reports.
import { fileURLToPath } from "node:url";
import { run, isWindows } from "./exec.js";

// Chipsets known to support monitor mode with Linux drivers (what people buy for Wi-Fi testing).
export const MONITOR_CHIPSETS = [
  { match: /RTL88(12|11|21)AU|RTL8814AU/i, chip: "Realtek RTL8812AU/8811AU family", note: "monitor mode works on Linux with the rtl8812au driver" },
  { match: /MT7612U|MT7610U|MT7921AU|MT7601U/i, chip: "MediaTek", note: "monitor mode works on Linux with the built-in mt76 driver" },
  { match: /AR9271|Atheros.*9271/i, chip: "Atheros AR9271", note: "monitor mode works on Linux with the built-in ath9k_htc driver" },
  { match: /RT3070|RT5370|RT5572/i, chip: "Ralink", note: "monitor mode works on Linux with the built-in rt2800usb driver" },
];
const ALFA_OUI = "00:c0:ca"; // MAC prefix registered to ALFA Inc.
export const isAlfa = (mac = "") => mac.toLowerCase().startsWith(ALFA_OUI);

// ---------- Windows (netsh) parsers. Keys are matched in English and French. ----------
function kv(line) {
  const i = line.indexOf(":");
  return i < 0 ? null : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

export function parseNetshInterfaces(text) {
  const adapters = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const p = kv(line);
    if (!p) continue;
    const [k, v] = p;
    if (/^(Name|Nom)$/i.test(k)) adapters.push((cur = { name: v }));
    else if (!cur) continue;
    else if (/^Description$/i.test(k)) cur.description = v;
    else if (/^(Physical address|Adresse physique)$/i.test(k)) cur.mac = v.toLowerCase();
    else if (/^(State|.tat)$/i.test(k)) cur.connected = /^(connected|connecté)$/i.test(v);
    else if (/^SSID$/i.test(k)) cur.ssid = v;
    else if (/^(Authentication|Authentification)$/i.test(k)) cur.auth = v;
    else if (/^(Cipher|Chiffrement)$/i.test(k)) cur.cipher = v;
  }
  return adapters;
}

export function parseNetshCapabilities(text) {
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const p = kv(line);
    if (!p) continue;
    if (/^(Interface name|Nom de l.interface)$/i.test(p[0])) cur = out[p[1]] = {};
    else if (cur && /monitor/i.test(p[0])) cur.monitorSupported = /^(supported|pris en charge)$/i.test(p[1]);
  }
  return out;
}

export function parseNetshNetworks(text) {
  const nets = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const ssid = line.match(/^SSID \d+ : (.*)$/);
    if (ssid) { nets.push((cur = { ssid: ssid[1].trim() })); continue; }
    const p = kv(line);
    if (!cur || !p) continue;
    if (/^(Authentication|Authentification)$/i.test(p[0])) cur.auth = p[1];
    else if (/^(Encryption|Chiffrement)$/i.test(p[0])) cur.cipher = p[1];
    else if (/^Signal$/i.test(p[0]) && cur.signal === undefined) cur.signal = Number.parseInt(p[1], 10);
  }
  return nets;
}

// ---------- Linux (iw / nmcli) parsers ----------
export function parseIwDev(text) {
  const out = [];
  let phy = null;
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^phy#(\d+)/))) phy = `phy${m[1]}`;
    else if ((m = line.match(/^Interface (\S+)/))) out.push((cur = { name: m[1], phy }));
    else if (cur && (m = line.match(/^addr ([0-9a-f:]{17})/i))) cur.mac = m[1].toLowerCase();
    else if (cur && (m = line.match(/^type (\S+)/))) cur.type = m[1];
    else if (cur && (m = line.match(/^ssid (.+)/))) cur.ssid = m[1];
  }
  return out;
}

// `iw list`: which phys list "monitor" under "Supported interface modes"
export function parseIwListMonitor(text) {
  const result = {};
  let phy = null;
  let inModes = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = raw.match(/^Wiphy (\S+)/))) { phy = m[1]; result[phy] = false; inModes = false; }
    else if (/^Supported interface modes:/.test(line)) inModes = true;
    else if (inModes && line.startsWith("*")) { if (/\bmonitor\b/.test(line)) result[phy] = true; }
    else if (inModes) inModes = false;
  }
  return result;
}

// `nmcli -t -f ACTIVE,SSID,SECURITY,SIGNAL dev wifi` (colons inside SSIDs are escaped as \:)
export function parseNmcli(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ":"));
    return { active: parts[0] === "yes", ssid: parts[1], auth: parts.length > 2 ? parts[2] || "Open" : "", signal: Number(parts[3]) || undefined };
  });
}

// ---------- Beacon details: WPS ----------
// Routers announce WPS in their beacons inside a vendor element (id 221, OUI 00:50:F2, type 4) made of big-endian
// type/length/value attributes. Anyone nearby receives these; reading them needs no monitor mode.
export function parseWps(body) {
  const wps = { version: null, configured: null, locked: false, version2: null };
  for (let j = 4; j + 4 <= body.length; ) {
    const type = body.readUInt16BE(j);
    const len = body.readUInt16BE(j + 2);
    const v = body.subarray(j + 4, j + 4 + len);
    if (type === 0x104a && len >= 1) wps.version = `${v[0] >> 4}.${v[0] & 15}`;
    else if (type === 0x1044 && len >= 1) wps.configured = v[0] === 2;
    else if (type === 0x1057 && len >= 1) wps.locked = v[0] === 1;
    else if (type === 0x1049 && len >= 3 && v.subarray(0, 3).toString("hex") === "00372a") {
      for (let k = 3; k + 2 <= v.length; k += 2 + v[k + 1]) if (v[k] === 0 && v[k + 1] >= 1) wps.version2 = `${v[k + 2] >> 4}.${v[k + 2] & 15}`;
    }
    j += 4 + len;
  }
  return wps;
}

// RSN (id 48) and the old WPA vendor element list the ciphers and key types the network accepts.
const AKM = { 1: "802.1X", 2: "PSK", 5: "802.1X", 6: "PSK", 8: "SAE", 12: "802.1X", 13: "802.1X", 18: "OWE", 24: "SAE", 25: "SAE" };
const CIPHER = { 1: "WEP", 2: "TKIP", 4: "CCMP", 5: "WEP", 8: "GCMP", 9: "GCMP", 10: "CCMP" };
function parseSuites(b, off) {
  // group cipher (4), pairwise count + list, AKM count + list
  const out = { ciphers: [], akms: [] };
  let o = off + 4;
  if (o + 2 > b.length) return out;
  const pc = b.readUInt16LE(o); o += 2;
  for (let k = 0; k < pc && o + 4 <= b.length; k++, o += 4) out.ciphers.push(CIPHER[b[o + 3]] || "other");
  if (o + 2 > b.length) return out;
  const ac = b.readUInt16LE(o); o += 2;
  for (let k = 0; k < ac && o + 4 <= b.length; k++, o += 4) out.akms.push(AKM[b[o + 3]] || "other");
  return out;
}

export function parseIes(buf, capability = null) {
  let wps = null;
  let rsn = null;
  let wpa = null;
  for (let i = 0; i + 2 <= buf.length; i += 2 + buf[i + 1]) {
    const body = buf.subarray(i + 2, i + 2 + buf[i + 1]);
    if (buf[i] === 48 && body.length >= 2) rsn = parseSuites(body, 2); // after the 2-byte version
    if (buf[i] === 221 && body.length >= 4) {
      const head = body.subarray(0, 4).toString("hex");
      if (head === "0050f204") wps = parseWps(body);
      if (head === "0050f201") wpa = parseSuites(body, 6); // after OUI+type (4) and version (2)
    }
  }
  const privacy = capability === null ? null : Boolean(capability & 0x10);
  return { wps, security: { rsn, wpa, privacy } };
}

// Turns what the beacon announces into the same words Windows uses ("WPA2-Personal", "CCMP").
export function beaconProtection(sec) {
  if (!sec) return null;
  const { rsn, wpa, privacy } = sec;
  if (rsn) {
    const a = new Set(rsn.akms);
    const names = [];
    if (a.has("PSK")) names.push("WPA2-Personal");
    if (a.has("SAE")) names.push("WPA3-Personal");
    if (a.has("802.1X")) names.push("WPA2-Enterprise");
    if (a.has("OWE")) names.push("OWE");
    return { auth: names.join(" ") || "RSN", cipher: [...new Set(rsn.ciphers)].join(" ") };
  }
  if (wpa) return { auth: "WPA-Personal", cipher: [...new Set(wpa.ciphers)].join(" ") };
  if (privacy === true) return { auth: "Open", cipher: "WEP" };
  if (privacy === false) return { auth: "Open", cipher: "None" };
  return null;
}

// Output of src/win/wlan-bss.ps1: ssidHex <TAB> bssid <TAB> rssi <TAB> iesHex [<TAB> capability]
export function parseWlanBss(text) {
  return text.split(/\r?\n/).filter((l) => [4, 5].includes(l.split("\t").length)).map((l) => {
    const [ssidHex, bssid, rssi, ies, cap] = l.split("\t");
    return { ssid: Buffer.from(ssidHex, "hex").toString("utf8"), bssid: bssid.toLowerCase(), rssi: Number(rssi), ...parseIes(Buffer.from(ies, "hex"), cap === undefined ? null : Number(cap)) };
  });
}

// Linux `iw dev <if> scan dump` (the cached results of the last scan).
export function parseIwScan(text) {
  const out = [];
  let cur = null;
  let inWps = false;
  let sec = null;
  for (const raw of text.split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^BSS ([0-9a-f:]{17})/i))) {
      out.push((cur = { ssid: "", bssid: m[1].toLowerCase(), rssi: null, wps: null, security: { rsn: null, wpa: null, privacy: null } }));
      inWps = false;
      sec = null;
      continue;
    }
    if (!cur) continue;
    if (/^\t(RSN|WPA):/.test(raw)) sec = cur.security[raw.startsWith("\tRSN") ? "rsn" : "wpa"] = { ciphers: [], akms: [] };
    else if (/^\t\S/.test(raw)) sec = null;
    if (sec && (m = raw.match(/\* Pairwise ciphers: (.*)$/))) sec.ciphers = m[1].trim().split(/\s+/).map((c) => c.replace(/-128$/, ""));
    if (sec && (m = raw.match(/\* Authentication suites: (.*)$/))) sec.akms = m[1].replace(/IEEE 802\.1X/g, "802.1X").trim().split(/\s+/).map((a) => (/^(FT\/)?PSK/.test(a) ? "PSK" : /SAE/.test(a) ? "SAE" : a));
    if ((m = raw.match(/^\tcapability: (.*)$/))) cur.security.privacy = /\bPrivacy\b/.test(m[1]);
    if ((m = raw.match(/^\tSSID: (.*)$/))) cur.ssid = m[1];
    else if ((m = raw.match(/^\tsignal: (-?[\d.]+)/))) cur.rssi = Math.round(Number(m[1]));
    else if (/^\tWPS:/.test(raw)) { inWps = true; cur.wps = { version: null, configured: null, locked: false, version2: null }; }
    else if (/^\t\S/.test(raw)) inWps = false;
    if (inWps && cur.wps) {
      if ((m = raw.match(/\* Version: ([\d.]+)/))) cur.wps.version = m[1];
      if ((m = raw.match(/\* Wi-Fi Protected Setup State: (\d)/))) cur.wps.configured = m[1] === "2";
      if ((m = raw.match(/\* AP setup locked: (0x)?0*(\d)/))) cur.wps.locked = m[2] === "1";
      if ((m = raw.match(/\* Version2: ([\d.]+)/))) cur.wps.version2 = m[1];
    }
  }
  return out;
}

// ---------- Is this access point the same hardware as a device on the network? ----------
const macBytes = (mac = "") => mac.toLowerCase().split(/[:-]/).map((h) => parseInt(h, 16));
// A device's network MAC and its Wi-Fi radio MAC usually differ only in the first byte (e.g. 82:3a:7c:10:5e:21 on
// the network, 90:3a:7c:10:5e:21 as the Wi-Fi name). Matching the last four bytes is very unlikely by chance.
export function sameHardware(lanMac, bssid) {
  const a = macBytes(lanMac);
  const b = macBytes(bssid);
  return a.length === 6 && b.length === 6 && a.slice(2).every((x, i) => x === b[i + 2]);
}
// Two Wi-Fi names from the same router (main + guest, 2.4 + 5 GHz) have nearly identical radio MACs.
export function sameRouter(bssidA, bssidB) {
  const a = macBytes(bssidA);
  const b = macBytes(bssidB);
  if (a.length !== 6 || b.length !== 6 || bssidA === bssidB) return false;
  return a.slice(1).filter((x, i) => x === b[i + 1]).length >= 4;
}

// ---------- Plain-language protection level ----------
export function protectionLevel(auth = "", cipher = "") {
  const a = `${auth} ${cipher}`.toUpperCase();
  if (/WPA3|SAE/.test(a) && !/WPA2/.test(a)) return "wpa3";
  if (/WPA3|SAE/.test(a)) return "wpa2-wpa3";
  if (/WPA2|RSN/.test(a)) return /TKIP/.test(a) && !/CCMP|AES/.test(a) ? "wpa2-tkip" : "wpa2";
  if (/WPA/.test(a)) return "wpa";
  if (/WEP/.test(a)) return "wep";
  if (/OPEN|--/.test(a)) return "open"; // missing information is "unknown", never "open"
  return "unknown";
}

function chipsetHint(description = "", mac = "") {
  const hit = MONITOR_CHIPSETS.find((c) => c.match.test(description));
  const alfa = mac.startsWith(ALFA_OUI);
  return hit ? { chip: hit.chip, note: hit.note, alfa } : alfa ? { chip: "ALFA adapter", note: "ALFA adapters are made for Wi-Fi testing", alfa } : null;
}

const WLAN_SCRIPT = fileURLToPath(new URL("./win/wlan-bss.ps1", import.meta.url));

// beacons: also read the beacon details (WPS). Takes ~5 s on Windows because it waits for a fresh scan.
export async function wifiSurvey({ beacons = true } = {}) {
  if (isWindows) {
    const ifaces = parseNetshInterfaces((await run("netsh", ["wlan", "show", "interfaces"])).stdout);
    const caps = parseNetshCapabilities((await run("netsh", ["wlan", "show", "wirelesscapabilities"])).stdout);
    let aps = [];
    if (beacons && ifaces.length) {
      const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WLAN_SCRIPT], 25000);
      aps = r.ok ? parseWlanBss(r.stdout) : [];
    }
    // Read the network list after the fresh scan, so it includes everything the scan just heard.
    const networks = parseNetshNetworks((await run("netsh", ["wlan", "show", "networks", "mode=bssid"])).stdout);
    const adapters = ifaces.map((i) => ({
      name: i.name,
      description: i.description || "",
      mac: i.mac || "",
      connected: Boolean(i.connected),
      ssid: i.connected ? i.ssid : null,
      auth: i.connected ? i.auth : null,
      cipher: i.connected ? i.cipher : null,
      monitorSupported: caps[i.name]?.monitorSupported ?? null,
      inMonitorMode: null, // Windows can't tell without Npcap; reported as unknown
      chipset: chipsetHint(i.description, i.mac),
    }));
    return { platform: "windows", adapters, networks, aps, wpsCheckable: aps.length > 0 };
  }
  const devs = parseIwDev((await run("iw", ["dev"])).stdout);
  const monitorByPhy = parseIwListMonitor((await run("iw", ["list"])).stdout);
  const nm = parseNmcli((await run("nmcli", ["-t", "-f", "ACTIVE,SSID,SECURITY,SIGNAL", "dev", "wifi"])).stdout);
  const active = nm.find((n) => n.active);
  const adapters = devs.map((d) => ({
    name: d.name,
    description: d.phy || "",
    mac: d.mac || "",
    connected: Boolean(d.ssid),
    ssid: d.ssid || null,
    auth: d.ssid && active && active.ssid === d.ssid ? active.auth : null,
    cipher: null,
    monitorSupported: monitorByPhy[d.phy] ?? null,
    inMonitorMode: d.type === "monitor",
    chipset: chipsetHint("", d.mac || ""),
  }));
  const networks = nm.map((n) => ({ ssid: n.ssid, auth: n.auth, signal: n.signal }));
  let aps = [];
  const managed = devs.find((d) => d.type !== "monitor");
  if (beacons && managed) aps = parseIwScan((await run("iw", ["dev", managed.name, "scan", "dump"])).stdout);
  return { platform: "linux", adapters, networks, aps, wpsCheckable: aps.length > 0 };
}
