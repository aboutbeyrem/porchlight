// Parsers for what the operating system reports. Samples are synthetic (no real network names or addresses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWindowsRoutes, parseLinuxRoutes, hostsToCheck } from "../src/network.js";
import { parseWindowsArp, parseLinuxNeigh } from "../src/discover.js";
import {
  parseNetshInterfaces, parseNetshCapabilities, parseNetshNetworks, parseIwDev, parseIwListMonitor, parseNmcli,
  protectionLevel, parseWlanBss, parseIwScan, parseIes, beaconProtection, sameHardware, sameRouter,
} from "../src/wifi.js";
import { parseSsdpResponse, parseDescription } from "../src/ssdp.js";

test("Windows default route: lowest metric wins", () => {
  const text = `===========\nActive Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0     10.0.0.1      10.0.0.23     50\n          0.0.0.0          0.0.0.0  192.168.50.1  192.168.50.7     25\n`;
  assert.deepEqual(parseWindowsRoutes(text), { gateway: "192.168.50.1", address: "192.168.50.7", metric: 25 });
  assert.equal(parseWindowsRoutes("no routes here"), null);
});

test("Linux default route", () => {
  const text = "default via 192.168.50.1 dev wlan0 proto dhcp src 192.168.50.7 metric 600\ndefault via 10.0.0.1 dev eth0 proto dhcp metric 100\n";
  assert.deepEqual(parseLinuxRoutes(text), { gateway: "10.0.0.1", dev: "eth0", address: null, metric: 100 });
});

test("hosts to check: a /24 is 254 hosts, bigger networks narrow to the /24 around us", () => {
  const a = hostsToCheck("192.168.50.7", 24);
  assert.equal(a.hosts.length, 254);
  assert.equal(a.cidr, "192.168.50.0/24");
  assert.equal(a.narrowed, false);
  const b = hostsToCheck("10.1.2.3", 16);
  assert.equal(b.cidr, "10.1.2.0/24");
  assert.equal(b.narrowed, true);
  assert.equal(hostsToCheck("192.168.50.7", 30).hosts.length, 2);
});

test("Windows arp table: dynamic entries only", () => {
  const text = "Interface: 192.168.50.7 --- 0xf\n  Internet Address      Physical Address      Type\n  192.168.50.1          02-11-22-33-44-55     dynamic\n  192.168.50.255        ff-ff-ff-ff-ff-ff     static\n  224.0.0.22            01-00-5e-00-00-16     static\n";
  assert.deepEqual(parseWindowsArp(text), [{ ip: "192.168.50.1", mac: "02:11:22:33:44:55" }]);
});

test("Linux neighbour table: skips failed entries", () => {
  const text = "192.168.50.1 dev wlan0 lladdr 02:11:22:33:44:55 REACHABLE\n192.168.50.9 dev wlan0 FAILED\n192.168.50.12 dev wlan0 lladdr 02:aa:bb:cc:dd:ee STALE\n";
  assert.deepEqual(parseLinuxNeigh(text).map((d) => d.ip), ["192.168.50.1", "192.168.50.12"]);
});

test("netsh interfaces, English and French", () => {
  const en = "    Name                   : Wi-Fi\n    Description            : Realtek RTL8812AU Wireless LAN 802.11ac USB NIC\n    Physical address       : 00:c0:ca:00:00:01\n    State                  : connected\n    SSID                   : HomeNet\n    Authentication         : WPA2-Personal\n    Cipher                 : CCMP\n";
  const [a] = parseNetshInterfaces(en);
  assert.equal(a.name, "Wi-Fi");
  assert.equal(a.connected, true);
  assert.equal(a.ssid, "HomeNet");
  assert.equal(a.auth, "WPA2-Personal");
  const fr = "    Nom                    : Wi-Fi\n    Description            : Intel(R) Wi-Fi 6 AX201\n    Adresse physique       : 02:00:00:00:00:01\n    État                   : connecté\n    SSID                   : Maison\n    Authentification       : WPA3-Personnel\n    Chiffrement            : CCMP\n";
  const [b] = parseNetshInterfaces(fr);
  assert.equal(b.connected, true);
  assert.equal(b.ssid, "Maison");
  assert.equal(protectionLevel(b.auth, b.cipher), "wpa3");
});

test("netsh wireless capabilities: monitor mode", () => {
  const text = "Interface name: Wi-Fi\n\n    Network monitor mode                    : Not supported\n\nInterface name: Wi-Fi 2\n\n    Network monitor mode                    : Supported\n";
  assert.deepEqual(parseNetshCapabilities(text), { "Wi-Fi": { monitorSupported: false }, "Wi-Fi 2": { monitorSupported: true } });
});

test("netsh networks", () => {
  const text = "SSID 1 : HomeNet\n    Network type            : Infrastructure\n    Authentication          : WPA2-Personal\n    Encryption              : CCMP\n    BSSID 1                 : 02:11:22:33:44:55\n         Signal             : 80%\nSSID 2 : CafeFree\n    Authentication          : Open\n    Encryption              : None\n";
  const nets = parseNetshNetworks(text);
  assert.equal(nets.length, 2);
  assert.equal(nets[0].signal, 80);
  assert.equal(protectionLevel(nets[1].auth, nets[1].cipher), "open");
});

test("iw dev, iw list and nmcli", () => {
  const dev = "phy#1\n\tInterface wlan1\n\t\tifindex 5\n\t\taddr 00:c0:ca:00:00:01\n\t\ttype monitor\nphy#0\n\tInterface wlan0\n\t\taddr 02:00:00:00:00:02\n\t\tssid HomeNet\n\t\ttype managed\n";
  assert.deepEqual(parseIwDev(dev).map((d) => [d.name, d.phy, d.type, d.ssid || null]), [["wlan1", "phy1", "monitor", null], ["wlan0", "phy0", "managed", "HomeNet"]]);
  const list = "Wiphy phy0\n\tSupported interface modes:\n\t\t * IBSS\n\t\t * managed\n\t\t * AP\n\tBand 1:\nWiphy phy1\n\tSupported interface modes:\n\t\t * managed\n\t\t * monitor\n";
  assert.deepEqual(parseIwListMonitor(list), { phy0: false, phy1: true });
  const nm = parseNmcli("yes:HomeNet:WPA2:80\nno:Cafe\\:Free::40\n");
  assert.equal(nm[0].active, true);
  assert.equal(nm[1].ssid, "Cafe:Free");
  assert.equal(nm[1].auth, "Open"); // nmcli leaves SECURITY empty for open networks
});

test("protection levels, and missing information is never called open", () => {
  assert.equal(protectionLevel("WPA2-Personal", "CCMP"), "wpa2");
  assert.equal(protectionLevel("WPA2-Personal WPA3-Personal", "CCMP"), "wpa2-wpa3");
  assert.equal(protectionLevel("WPA2-Personal", "TKIP"), "wpa2-tkip");
  assert.equal(protectionLevel("WPA-Personal", "TKIP"), "wpa");
  assert.equal(protectionLevel("Open", "WEP"), "wep");
  assert.equal(protectionLevel("Open", "None"), "open");
  assert.equal(protectionLevel("", ""), "unknown");
  assert.equal(protectionLevel(undefined, undefined), "unknown");
});

// Builds beacon information elements the way an access point sends them.
const ie = (id, body) => Buffer.concat([Buffer.from([id, body.length]), body]);
const tlv = (type, value) => { const h = Buffer.alloc(4); h.writeUInt16BE(type, 0); h.writeUInt16BE(value.length, 2); return Buffer.concat([h, value]); };
const rsnPsk = ie(48, Buffer.from("0100" + "000fac04" + "0100" + "000fac04" + "0100" + "000fac02" + "0000", "hex"));
const wps = (locked) => ie(221, Buffer.concat([Buffer.from("0050f204", "hex"), tlv(0x104a, Buffer.from([0x10])), tlv(0x1044, Buffer.from([2])), ...(locked ? [tlv(0x1057, Buffer.from([1]))] : []), tlv(0x1049, Buffer.from("00372a000120", "hex"))]));

test("beacon elements: WPS and WPA2 are read from the access point's announcement", () => {
  const { wps: w, security } = parseIes(Buffer.concat([ie(0, Buffer.from("HomeNet")), rsnPsk, wps(false)]), 0x0411);
  assert.deepEqual(w, { version: "1.0", configured: true, locked: false, version2: "2.0" });
  assert.deepEqual(beaconProtection(security), { auth: "WPA2-Personal", cipher: "CCMP" });
  assert.equal(parseIes(Buffer.concat([rsnPsk, wps(true)])).wps.locked, true);
  assert.equal(parseIes(rsnPsk).wps, null);
  assert.deepEqual(beaconProtection(parseIes(Buffer.alloc(0), 0x0411).security), { auth: "Open", cipher: "WEP" });
  assert.deepEqual(beaconProtection(parseIes(Buffer.alloc(0), 0x0401).security), { auth: "Open", cipher: "None" });
  assert.equal(beaconProtection(parseIes(Buffer.alloc(0)).security), null); // no capability info: unknown
});

test("Windows beacon helper output", () => {
  const line = `${Buffer.from("HomeNet").toString("hex")}\t02:11:22:33:44:55\t-60\t${Buffer.concat([rsnPsk, wps(false)]).toString("hex")}\t1041`;
  const [ap] = parseWlanBss(`${line}\ngarbage line\n`);
  assert.equal(ap.ssid, "HomeNet");
  assert.equal(ap.bssid, "02:11:22:33:44:55");
  assert.equal(ap.rssi, -60);
  assert.equal(ap.wps.configured, true);
});

test("iw scan dump: WPS and security", () => {
  const text = [
    "BSS 02:11:22:33:44:55(on wlan0)",
    "\tsignal: -61.00 dBm",
    "\tcapability: ESS Privacy ShortSlotTime (0x0411)",
    "\tSSID: HomeNet",
    "\tRSN:\t * Version: 1",
    "\t\t * Group cipher: CCMP",
    "\t\t * Pairwise ciphers: CCMP",
    "\t\t * Authentication suites: PSK SAE",
    "\tWPS:\t * Version: 1.0",
    "\t\t * Wi-Fi Protected Setup State: 2 (Configured)",
    "\t\t * AP setup locked: 0x01",
    "\t\t * Version2: 2.0",
    "BSS 02:aa:bb:cc:dd:ee(on wlan0)",
    "\tcapability: ESS (0x0401)",
    "\tSSID: CafeFree",
  ].join("\n");
  const [a, b] = parseIwScan(text);
  assert.equal(a.ssid, "HomeNet");
  assert.equal(a.rssi, -61);
  assert.deepEqual(a.wps, { version: "1.0", configured: true, locked: true, version2: "2.0" });
  assert.equal(protectionLevel(beaconProtection(a.security).auth, beaconProtection(a.security).cipher), "wpa2-wpa3");
  assert.equal(b.wps, null);
  assert.equal(protectionLevel(beaconProtection(b.security).auth, beaconProtection(b.security).cipher), "open");
});

test("matching radios to devices", () => {
  assert.equal(sameHardware("82:3a:7c:10:5e:21", "90:3a:7c:10:5e:21"), true); // same device, different first byte
  assert.equal(sameHardware("82:3a:7c:10:5e:21", "90:3a:7c:10:5e:22"), false);
  assert.equal(sameRouter("4c:11:22:33:44:55", "4e:11:22:43:44:55"), true); // main + second network
  assert.equal(sameRouter("4c:11:22:33:44:55", "20:aa:bb:cc:dd:ee"), false); // a neighbour
  assert.equal(sameRouter("4c:11:22:33:44:55", "4c:11:22:33:44:55"), false);
});

test("UPnP description", () => {
  const h = parseSsdpResponse("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.50.1:49152/desc.xml\r\nSERVER: Linux UPnP/1.0\r\n\r\n");
  assert.equal(h.location, "http://192.168.50.1:49152/desc.xml");
  const xml = "<root><URLBase>http://192.168.50.1:49152/</URLBase><device><friendlyName>Home Router</friendlyName><manufacturer>Acme</manufacturer><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>";
  const d = parseDescription(xml, h.location);
  assert.equal(d.friendlyName, "Home Router");
  assert.equal(d.services[0].controlUrl, "http://192.168.50.1:49152/ctl/IPConn");
});
