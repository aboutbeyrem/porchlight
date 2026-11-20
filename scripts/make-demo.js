// Builds public/demo.json: a sample report of a made-up home, produced by the real rules (so the demo can't drift
// from what Porchlight actually says). Run: node scripts/make-demo.js
import fs from "node:fs";
import { buildFindings, changeFindings, summarize, scoreOf, deviceName, deviceKind, ownNetworks, LEVELS } from "../src/findings.js";
import { COMMON_PORTS } from "../src/ports.js";
import { annotate } from "../src/catalog.js";

const rsn = { rsn: { ciphers: ["CCMP"], akms: ["PSK"] }, wpa: null, privacy: true };
const open = { rsn: null, wpa: null, privacy: false };

const router = { ip: "192.168.1.1", mac: "02:10:20:30:40:01", isRouter: true, friendlyName: "Home Router", ports: [80, 443] };
const me = { ip: "192.168.1.50", self: true, ports: [] };
const ext = { ip: "192.168.1.115", mac: "82:3a:7c:10:5e:21", ports: [80], web: { url: "http://192.168.1.115/", label: "PIX-LINK", title: "PIX-LINK" }, broadcasts: ["HomeNet-EXT"] };
const cam = { ip: "192.168.1.120", mac: "02:44:55:66:77:88", hostname: "IPC-Living-Room.lan", ports: [80, 554], rtsp: { state: "open", port: 554, path: "/live" }, web: { url: "http://192.168.1.120/", label: null } };
const tv = { ip: "192.168.1.140", mac: "02:51:52:53:54:55", ports: [5555], mdns: { name: "Living Room TV", kind: "TV or streaming device", model: "Android TV", services: ["_googlecast._tcp.local"] } };
const phone = { ip: "192.168.1.131", mac: "02:99:88:77:66:55", ports: [], mdns: { name: "Sara's iPhone", kind: "phone or tablet", model: "iPhone14,2", services: ["_companion-link._tcp.local"] } };
const laptop = { ip: "192.168.1.152", mac: "4a:12:34:56:78:9a", ports: [] };
const devices = [router, me, ext, cam, tv, phone, laptop];

const wifi = {
  adapters: [],
  networks: [{ ssid: "HomeNet", auth: "WPA2-Personal", cipher: "CCMP" }, { ssid: "HomeNet-EXT", auth: "WPA2-Personal", cipher: "CCMP" }],
  aps: [
    { ssid: "HomeNet", bssid: "4c:11:22:33:44:55", wps: null, security: rsn },
    { ssid: "HomeNet-EXT", bssid: "90:3a:7c:10:5e:21", wps: { version: "1.0", configured: true, locked: false, version2: "2.0" }, security: rsn },
    { ssid: "HomeNet", bssid: "6e:aa:bb:cc:dd:01", wps: null, security: open },
    { ssid: "Neighbour_5G", bssid: "20:aa:bb:cc:dd:ee", wps: null, security: rsn },
  ],
  wpsCheckable: true,
};
const upnp = { devices: [{ ip: router.ip }], router: { found: false, mappings: [] } };
const changes = {
  firstRun: false,
  since: "2026-11-13T18:30:00.000Z",
  newDevices: [tv],
  fixed: [{ title: "Old file-sharing service (FTP) is on", deviceName: "Your router (Home Router)" }],
};

const findings = buildFindings({ devices, upnp, routerAdmin: { reachable: true, https: true }, wifi, homeSsid: "HomeNet", firewall: { profiles: ["private"], on: true } });
findings.push(...changeFindings(changes));
annotate(findings, devices);
findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));

const report = {
  demo: true,
  when: "2026-11-20T18:00:00.000Z",
  durationSec: 34,
  profile: "home",
  scope: ["192.168.1.0/24"],
  network: { cidr: "192.168.1.0/24", gateway: "192.168.1.1", address: "192.168.1.50", interface: "Wi-Fi", narrowed: false },
  homeSsid: "HomeNet",
  score: scoreOf(findings),
  changes: { firstRun: false, since: changes.since, newDevices: [tv.ip], fixed: changes.fixed.map((p) => p.title) },
  devices: devices.map((d) => ({
    ip: d.ip, name: deviceName(d), kind: deviceKind(d), vendor: null, ports: d.ports,
    doors: d.ports.map((p) => ({ port: p, name: COMMON_PORTS[p].name, plain: COMMON_PORTS[p].plain })),
    mac: "", self: Boolean(d.self), isRouter: Boolean(d.isRouter), web: d.web?.url || null, broadcasts: d.broadcasts || [], isNew: d === tv,
  })),
  wifi: { yours: ownNetworks({ wifi, homeSsid: "HomeNet", devices }).map((n) => ({ ssid: n.ssid, reason: n.reason, auth: n.auth || null, wps: n.aps.some((a) => a.wps), device: n.device?.ip || null })), wpsCheckable: true },
  summary: summarize(findings),
  findings,
};
fs.writeFileSync(new URL("../public/demo.json", import.meta.url), JSON.stringify(report, null, 1));
console.log(`${report.score.value}/100 ${report.score.label}. ${report.summary}`);
for (const f of findings) console.log(`  ${f.level.padEnd(12)} ${f.title}${f.deviceName ? `  (${f.deviceName})` : ""}`);
