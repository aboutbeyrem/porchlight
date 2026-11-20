// Device names, fake copies of your Wi-Fi, memory between checkups, the score, and the newer service checks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeQuery, decodeMessage, summarizeMdns, parseNbstat, isPrivateMac, TYPE } from "../src/mdns.js";
import { parseVendorList } from "../src/identify.js";
import { parseFirewall } from "../src/system.js";
import { compare, updateEntry, loadHistory, saveHistory, forgetHistory } from "../src/history.js";
import { buildFindings, changeFindings, lookalikes, ownNetworks, scoreOf, deviceKind, deviceName } from "../src/findings.js";

// ---------- a tiny DNS answer builder for the mDNS tests ----------
const name = (n) => Buffer.concat([...n.split(".").map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])]);
function rr(n, type, data) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(120, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([name(n), head, data]);
}
function answer(records) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(0x8400, 2);
  h.writeUInt16BE(records.length, 6);
  return Buffer.concat([h, ...records]);
}
const txt = (pairs) => Buffer.concat(pairs.map((p) => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])));
const srv = (port, target) => { const b = Buffer.alloc(6); b.writeUInt16BE(port, 4); return Buffer.concat([b, name(target)]); };

test("mDNS: queries encode, answers decode into device names and kinds", () => {
  const q = encodeQuery([{ name: "_googlecast._tcp.local", type: TYPE.PTR }]);
  assert.equal(q.readUInt16BE(4), 1);
  assert.match(q.toString("latin1"), /_googlecast/);
  const msg = answer([
    rr("_googlecast._tcp.local", TYPE.PTR, name("Living-Room-abc._googlecast._tcp.local")),
    rr("Living-Room-abc._googlecast._tcp.local", TYPE.SRV, srv(8009, "abc123.local")),
    rr("Living-Room-abc._googlecast._tcp.local", TYPE.TXT, txt(["fn=Living Room TV", "md=Chromecast"])),
    rr("abc123.local", TYPE.A, Buffer.from([192, 168, 50, 40])),
    rr("Sara-iPhone._device-info._tcp.local", TYPE.TXT, txt(["model=iPhone14,2"])),
    rr("Sara-iPhone.local", TYPE.A, Buffer.from([192, 168, 50, 41])),
  ]);
  const recs = decodeMessage(msg);
  assert.equal(recs.length, 6);
  const s = summarizeMdns(recs);
  assert.equal(s["192.168.50.40"].name, "Living Room TV");
  assert.equal(s["192.168.50.40"].kind, "TV or streaming device");
  assert.equal(s["192.168.50.40"].model, "Chromecast");
  assert.equal(s["192.168.50.41"].kind, "phone or tablet");
  assert.equal(s["192.168.50.41"].host, "sara-iphone");
  assert.equal(decodeMessage(Buffer.from([1, 2, 3])), null);
});

test("NetBIOS node status gives the computer's name", () => {
  const nameEntry = (n, suffix, flags = 0x04) => Buffer.concat([Buffer.from(n.padEnd(15, " "), "latin1"), Buffer.from([suffix, flags, 0x00])]);
  const head = Buffer.from("504384000000000100000000", "hex");
  const q = Buffer.from("20434b4141414141414141414141414141414141414141414141414141414141410000210001", "hex");
  const ttlLen = Buffer.from("00000000" + "0041", "hex");
  const pkt = Buffer.concat([head, q, ttlLen, Buffer.from([2]), nameEntry("DESKTOP-ABC123", 0x00), nameEntry("WORKGROUP", 0x00, 0x84), Buffer.alloc(6)]);
  assert.deepEqual(parseNbstat(pkt), { name: "DESKTOP-ABC123", fileSharing: false });
  assert.equal(parseNbstat(Buffer.alloc(10)), null);
});

test("private (randomised) MAC addresses", () => {
  assert.equal(isPrivateMac("82:3a:7c:10:5e:21"), true);
  assert.equal(isPrivateMac("4a:12:34:56:78:9a"), true);
  assert.equal(isPrivateMac("00:c0:ca:00:00:01"), false);
  assert.equal(isPrivateMac("01:00:5e:00:00:16"), false); // multicast, not private
  assert.equal(isPrivateMac(""), false);
});

test("vendor lists from Wireshark, Nmap and IEEE files", () => {
  const m = parseVendorList("00:C0:CA\tAlfa\tALFA, Inc.\n00C0CB Nmap Vendor\n00-11-22   (hex)\t\tCIMSYS Inc\n00:1B:C5:00:00:00/36\tConverg\tConverging Systems\n");
  assert.deepEqual([...m.keys()], ["00c0ca", "00c0cb", "001122"]);
  assert.equal(m.get("00c0ca"), "ALFA, Inc.");
});

test("device kinds and names from every source", () => {
  assert.equal(deviceKind({ ip: "1", mdns: { kind: "printer" } }), "printer");
  assert.equal(deviceKind({ ip: "1", netbios: { name: "DESKTOP-ABC" } }), "computer");
  assert.equal(deviceKind({ ip: "1", vendor: "Hikvision Digital Technology" }), "camera or recorder");
  assert.equal(deviceKind({ ip: "1", vendor: "Espressif" }), "smart-home device");
  assert.equal(deviceKind({ ip: "1", mac: "4a:12:34:56:78:9a" }), "phone, tablet or laptop");
  assert.equal(deviceName({ ip: "192.168.50.7", netbios: { name: "DESKTOP-ABC" } }), "DESKTOP-ABC (192.168.50.7)");
  assert.equal(deviceName({ ip: "192.168.50.7", mac: "00:11:22:33:44:55", vendor: "Acme" }), "Acme device at 192.168.50.7");
});

test("Windows firewall state, English and French", () => {
  assert.deepEqual(parseFirewall("Private Profile Settings: \n----------\nState                                 ON\nOk.\n"), { private: true });
  assert.deepEqual(parseFirewall("Public Profile Settings:\nState                                 OFF\n"), { public: false });
  assert.deepEqual(parseFirewall("Paramètres du profil privé :\n----------\nÉtat                                  Actif\n"), { private: true });
});

// ---------- fake copies of your Wi-Fi ----------
const rsn = { rsn: { ciphers: ["CCMP"], akms: ["PSK"] }, wpa: null, privacy: true };
const open = { rsn: null, wpa: null, privacy: false };
const router = { ip: "192.168.50.1", mac: "02:00:00:00:00:01", isRouter: true, ports: [] };

test("an open network copying your Wi-Fi's name is flagged, and can't vouch for itself", () => {
  const wifi = {
    adapters: [], networks: [], wpsCheckable: true,
    aps: [
      { ssid: "HomeNet", bssid: "4c:11:22:33:44:55", security: rsn },
      { ssid: "HomeNet", bssid: "6e:aa:bb:cc:dd:01", security: open }, // the copy
      { ssid: "Neighbour", bssid: "20:aa:bb:cc:dd:ee", security: rsn }, // looks like the copy's hardware
    ],
  };
  const { copies } = lookalikes({ wifi, homeSsid: "HomeNet", devices: [router] });
  assert.equal(copies.length, 1);
  assert.equal(copies[0].level, "open");
  assert.equal(copies[0].weaker, true);
  // Your Wi-Fi is judged by your access point, not the copy, and the neighbour isn't adopted through the copy.
  const mine = ownNetworks({ wifi, homeSsid: "HomeNet", devices: [router] });
  assert.deepEqual(mine.map((n) => n.ssid), ["HomeNet"]);
  const fs = buildFindings({ devices: [router], wifi, homeSsid: "HomeNet" });
  assert.ok(fs.some((f) => f.level === "worth-fixing" && f.title === "A network with no password is using your Wi-Fi's name"));
  assert.ok(!fs.some((f) => /has no password/.test(f.title)), "your own Wi-Fi isn't called open because of the copy");
});

test("the access point you're connected to is always the real one", () => {
  const wifi = {
    adapters: [{ name: "Wi-Fi", connected: true, ssid: "HomeNet", auth: "WPA2-Personal", cipher: "CCMP", bssid: "4c:11:22:33:44:55" }],
    networks: [], wpsCheckable: true,
    aps: [{ ssid: "HomeNet", bssid: "6e:aa:bb:cc:dd:01", security: rsn }, { ssid: "HomeNet", bssid: "4c:11:22:33:44:55", security: rsn }],
  };
  const { copies } = lookalikes({ wifi, homeSsid: null, devices: [router] });
  assert.deepEqual(copies.map((c) => c.bssids[0]), ["6e:aa:bb:cc:dd:01"]);
  assert.equal(copies[0].weaker, false); // same protection: only "good to know"
});

test("your router's own second radio and your extender are not copies", () => {
  const ext = { ip: "192.168.50.30", mac: "82:3a:7c:10:5e:21", ports: [] };
  const wifi = {
    adapters: [], networks: [], wpsCheckable: true,
    aps: [
      { ssid: "HomeNet", bssid: "4c:11:22:33:44:55", security: rsn },
      { ssid: "HomeNet", bssid: "4e:11:22:43:44:55", security: rsn }, // same router, other band
      { ssid: "HomeNet", bssid: "90:3a:7c:10:5e:21", security: rsn }, // the extender, same name
    ],
  };
  assert.deepEqual(lookalikes({ wifi, homeSsid: "HomeNet", devices: [router, ext] }).copies, []);
  const fs = buildFindings({ devices: [router, ext], wifi, homeSsid: "HomeNet" });
  assert.ok(fs.some((f) => f.title === "No copies of your Wi-Fi nearby"));
});

test("names that differ only in capitals or spaces count as copies", () => {
  const wifi = { adapters: [], networks: [], wpsCheckable: true, aps: [{ ssid: "HomeNet", bssid: "4c:11:22:33:44:55", security: rsn }, { ssid: "homenet ", bssid: "6e:aa:bb:cc:dd:01", security: open }] };
  const [c] = lookalikes({ wifi, homeSsid: "HomeNet", devices: [router] }).copies;
  assert.equal(c.exactName, false);
  assert.equal(c.weaker, true);
});

// ---------- memory between checkups ----------
const tv = { ip: "192.168.50.40", mac: "02:51:52:53:54:55", ports: [5555] };
const ext = { ip: "192.168.50.30", mac: "82:3a:7c:10:5e:21", ports: [80] };
const problem = (title, device, ssid) => ({ level: "worth-fixing", title, device: device?.ip || null, ssid, fix: ["a", "b"] });

test("history: first run, new devices, and fixes that were really checked again", () => {
  const first = compare(undefined, [router, ext], []);
  assert.equal(first.firstRun, true);
  const findings1 = [problem('WPS is on for "Home-EXT"', ext, "Home-EXT"), problem("Old file-sharing service (FTP) is on", router)];
  const entry = updateEntry(null, [router, ext], findings1, "2026-11-13T18:00:00Z");

  // FTP fixed (router answered), WPS gone only because the extender was asleep: not "fixed".
  const later = compare(entry, [router, tv], [], new Set(["Home"]));
  assert.deepEqual(later.newDevices.map((d) => d.ip), ["192.168.50.40"]);
  assert.deepEqual(later.fixed.map((p) => p.title), ["Old file-sharing service (FTP) is on"]);
  assert.deepEqual(later.unverified.map((p) => p.title), ['WPS is on for "Home-EXT"']);

  // The unverified problem is carried forward, so a real fix later is still noticed.
  const entry2 = updateEntry(entry, [router, tv], [], "2026-11-20T18:00:00Z", undefined, later.unverified);
  const third = compare(entry2, [router, tv, ext], [], new Set(["Home", "Home-EXT"]));
  assert.deepEqual(third.fixed.map((p) => p.title), ['WPS is on for "Home-EXT"']);
  assert.deepEqual(third.newDevices, []); // the extender was seen before
  assert.equal(entry2.devices["82:3a:7c:10:5e:21"].firstSeen, "2026-11-13T18:00:00Z");
});

test("history findings read calmly", () => {
  const fs = changeFindings({ firstRun: false, since: "2026-11-13T18:00:00Z", newDevices: [tv], fixed: [{ title: "Old file-sharing service (FTP) is on", deviceName: "Your router" }] });
  assert.equal(fs[0].level, "good-to-know");
  assert.equal(fs[0].title, "A new device joined your network");
  assert.equal(fs[1].level, "all-good");
  assert.match(fs[1].found, /Old file-sharing service \(FTP\) is on \(Your router\)/);
  assert.deepEqual(changeFindings({ firstRun: true }), []);
});

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porchlight-")); process.env.PORCHLIGHT_DATA = tmp; });
after(() => { delete process.env.PORCHLIGHT_DATA; fs.rmSync(tmp, { recursive: true, force: true }); });

test("history is saved on this computer and can be forgotten", () => {
  assert.deepEqual(loadHistory(), { version: 2, networks: {} });
  assert.equal(saveHistory({ version: 2, networks: { a: { lastRun: "x", devices: {}, problems: [] } } }), true);
  assert.equal(loadHistory().networks.a.lastRun, "x");
  saveHistory({ version: 1, networks: { a: { lastRun: "old" } } });
  assert.deepEqual(loadHistory(), { version: 2, networks: {} }, "an older format is ignored, not misread");
  assert.equal(forgetHistory(), true);
  assert.deepEqual(loadHistory(), { version: 2, networks: {} });
});

// ---------- score and the newer checks ----------
test("score: problems cost points, notes and good news don't", () => {
  assert.deepEqual(scoreOf([]), { value: 100, label: "Well protected" });
  assert.equal(scoreOf([{ level: "worth-fixing" }, { level: "worth-fixing" }, { level: "good-to-know" }]).value, 80);
  assert.equal(scoreOf([{ level: "fix-soon" }, { level: "worth-fixing" }]).label, "Needs some attention");
  assert.equal(scoreOf(Array(6).fill({ level: "fix-soon" })).value, 0);
});

test("Android debugging, Docker, Telnet on 2323 and the firewall", () => {
  const box = { ip: "192.168.50.40", mac: "02:51:52:53:54:55", ports: [5555, 2323, 2375] };
  const me = { ip: "192.168.50.7", self: true, ports: [] };
  const titles = buildFindings({ devices: [router, box, me], firewall: { profiles: ["private"], on: false } }).map((f) => `${f.level}: ${f.title}`);
  assert.ok(titles.includes("fix-soon: Old remote-login service (Telnet) is on"));
  assert.ok(titles.includes("worth-fixing: Android debugging is open to the network"));
  assert.ok(titles.includes("worth-fixing: Docker can be controlled over the network without a password"));
  assert.ok(titles.includes("worth-fixing: This computer's firewall is off"));
  const on = buildFindings({ devices: [router, me], firewall: { profiles: ["private"], on: true } });
  assert.deepEqual(on.map((f) => f.title), ["This computer's firewall is on"]);
});

test("devices behind a MAC-rewriting repeater: not a second extender, and remembered separately", () => {
  const ext = { ip: "192.168.50.30", mac: "82:3a:7c:10:5e:21", ports: [80], web: { url: "http://192.168.50.30/", label: "AcmeExt" }, sharedMac: true };
  const phone = { ip: "192.168.50.44", mac: "82:3a:7c:10:5e:21", ports: [], sharedMac: true, behind: ext.ip };
  assert.equal(deviceKind(phone), "device on your Wi-Fi extender");
  assert.equal(deviceName(phone), "Device on your Wi-Fi extender at 192.168.50.44");
  const wifi = { adapters: [], networks: [], wpsCheckable: true, aps: [{ ssid: "HomeNet-EXT", bssid: "90:3a:7c:10:5e:21", security: rsn, wps: { configured: true } }] };
  const [net] = ownNetworks({ wifi, homeSsid: "HomeNet", devices: [router, ext, phone] });
  assert.equal(net.device.ip, ext.ip, "the extender, not the phone behind it, broadcasts its network");
  const entry = updateEntry(null, [router, ext, phone], [], "2026-11-13T18:00:00Z");
  assert.deepEqual(Object.keys(entry.devices).sort(), ["02:00:00:00:00:01", "82:3a:7c:10:5e:21@192.168.50.30", "82:3a:7c:10:5e:21@192.168.50.44"]);
});
