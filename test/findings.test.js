// The rules that turn scan results into findings, and the tone they're written in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFindings, summarize, deviceKind, deviceName, ownNetworks, LEVELS } from "../src/findings.js";

const router = { ip: "192.168.50.1", mac: "02:00:00:00:00:01", isRouter: true, ports: [80, 443] };
const base = { devices: [router], upnp: { devices: [], router: { found: false, mappings: [] } }, routerAdmin: { reachable: true, https: true }, wifi: { adapters: [], networks: [], aps: [], wpsCheckable: false }, homeSsid: null };
const run = (over) => buildFindings({ ...base, ...over });
const titles = (fs) => fs.map((f) => `${f.level}: ${f.title}`);

test("every finding says what, why, how likely, and (if needed) how to fix", () => {
  const cam = { ip: "192.168.50.20", mac: "02:00:00:00:00:20", ports: [23, 554], rtsp: { state: "open", port: 554, path: "/" } };
  for (const f of run({ devices: [router, cam] })) {
    assert.ok(LEVELS.includes(f.level));
    for (const k of ["title", "found", "means", "likely"]) assert.ok(f[k] && f[k].length > 5, `${f.title}: ${k}`);
    if (f.level === "fix-soon" || f.level === "worth-fixing") assert.ok(f.fix.length >= 2, `${f.title} needs fix steps`);
    // No scare words.
    assert.doesNotMatch(`${f.title} ${f.found} ${f.means} ${f.likely}`, /hack(ed|ers?)|critical|danger|urgent|immediately|catastroph|!/i);
  }
});

test("telnet is fix soon; an open camera stream is worth fixing, or fix soon when forwarded to the internet", () => {
  const cam = { ip: "192.168.50.20", mac: "02:00:00:00:00:20", ports: [23, 554], rtsp: { state: "open", port: 554, path: "/" } };
  const local = run({ devices: [router, cam] });
  assert.ok(titles(local).includes("fix-soon: Old remote-login service (Telnet) is on"));
  assert.ok(titles(local).includes("worth-fixing: Camera video can be watched without a password"));
  const forwarded = run({ devices: [router, cam], upnp: { devices: [], router: { found: true, mappings: [{ enabled: true, internalClient: cam.ip, internalPort: 554, externalPort: 554, protocol: "TCP" }] } } });
  assert.ok(titles(forwarded).includes("fix-soon: Camera video can be watched without a password"));
  assert.ok(titles(forwarded).includes("fix-soon: A device opened a door to the internet by itself"));
});

test("a password-protected camera stream is all good", () => {
  const cam = { ip: "192.168.50.20", mac: "02:00:00:00:00:20", ports: [554], rtsp: { state: "protected", port: 554 } };
  assert.ok(titles(run({ devices: [router, cam] })).includes("all-good: Camera video asks for a password"));
});

test("FTP on the router gets router-specific steps", () => {
  const [f] = run({ devices: [{ ...router, ports: [21, 80], ftp: "Pure-FTPd" }] });
  assert.equal(f.title, "Old file-sharing service (FTP) is on");
  assert.match(f.found, /Your router runs an FTP server \(Pure-FTPd\)/);
  assert.match(f.fix.join(" "), /USB, Storage or File sharing/);
});

test("UPnP: off is all good, on with nothing open is good to know, silence says nothing", () => {
  assert.ok(titles(run({ upnp: { devices: [{ ip: router.ip }], router: { found: false, mappings: [] } } })).includes("all-good: Devices can't open doors to the internet on their own"));
  assert.ok(titles(run({ upnp: { devices: [{ ip: router.ip }], router: { found: true, mappings: [] } } })).some((t) => t.startsWith("good-to-know: Your router lets devices open doors")));
  assert.deepEqual(run({}), []);
});

test("router page without HTTPS is only good to know", () => {
  const fs = run({ routerAdmin: { reachable: true, https: false, redirectsToHttps: false, title: "Router" } });
  assert.deepEqual(titles(fs), ["good-to-know: Router settings page is not encrypted"]);
});

test("which Wi-Fi networks are yours", () => {
  const ext = { ip: "192.168.50.30", mac: "82:3a:7c:10:5e:21", ports: [80], web: { url: "http://192.168.50.30/", label: "AcmeExt" } };
  const wifi = {
    adapters: [],
    networks: [],
    wpsCheckable: true,
    aps: [
      { ssid: "HomeNet", bssid: "4c:11:22:33:44:55", wps: null, security: { rsn: { ciphers: ["CCMP"], akms: ["PSK"] }, wpa: null, privacy: true } },
      { ssid: "HomeNet-Guest", bssid: "4e:11:22:43:44:55", wps: null, security: { rsn: { ciphers: ["CCMP"], akms: ["PSK"] }, wpa: null, privacy: true } },
      { ssid: "Upstairs", bssid: "90:3a:7c:10:5e:21", wps: { configured: true, locked: false }, security: { rsn: { ciphers: ["CCMP"], akms: ["PSK"] }, wpa: null, privacy: true } },
      { ssid: "Neighbour", bssid: "20:aa:bb:cc:dd:ee", wps: { configured: true }, security: { rsn: null, wpa: null, privacy: false } },
    ],
  };
  const mine = ownNetworks({ wifi, homeSsid: "HomeNet", devices: [router, ext] });
  assert.deepEqual(mine.map((n) => [n.ssid, n.reason]), [["HomeNet", "home"], ["HomeNet-Guest", "same-router"], ["Upstairs", "device"]]);

  const fs = run({ devices: [router, ext], wifi, homeSsid: "HomeNet" });
  const t = titles(fs);
  assert.ok(t.includes('worth-fixing: WPS is on for "Upstairs"'));
  assert.ok(t.includes("all-good: Your 3 Wi-Fi networks are well protected"));
  assert.ok(!t.some((x) => /Neighbour/.test(x)), "neighbours' networks are never reported");
  const wps = fs.find((f) => f.title.startsWith("WPS"));
  assert.match(wps.found, /broadcast by your AcmeExt extender at 192\.168\.50\.30/);
  assert.match(wps.fix[0], /http:\/\/192\.168\.50\.30\//);
});

test("a network with no security information is never reported as open", () => {
  const wifi = { adapters: [], networks: [{ ssid: "HomeNet" }], aps: [], wpsCheckable: false };
  assert.deepEqual(run({ wifi, homeSsid: "HomeNet" }), []);
});

test("an open home network is fix soon", () => {
  const wifi = { adapters: [], networks: [{ ssid: "HomeNet", auth: "Open", cipher: "None" }], aps: [], wpsCheckable: false };
  assert.deepEqual(titles(run({ wifi, homeSsid: "HomeNet" })), ['fix-soon: Your Wi-Fi "HomeNet" has no password']);
});

test("monitor mode: in use, supported, or possible only on Linux", () => {
  const adapter = (o) => ({ name: "wlan1", description: "USB adapter", mac: "00:c0:ca:00:00:01", connected: false, ...o });
  const one = (o) => run({ wifi: { adapters: [adapter(o)], networks: [], aps: [] } })[0];
  assert.equal(one({ inMonitorMode: true, monitorSupported: true }).title, "Your ALFA Wi-Fi adapter is in monitor mode");
  assert.equal(one({ inMonitorMode: false, monitorSupported: true }).title, "Your ALFA Wi-Fi adapter can do monitor mode (it's off)");
  assert.equal(one({ inMonitorMode: null, monitorSupported: false, chipset: { chip: "Realtek RTL8812AU/8811AU family", note: "works on Linux", alfa: true } }).title, "Your ALFA Wi-Fi adapter can do monitor mode on Linux, not on Windows");
  for (const level of [one({ inMonitorMode: true }).level, one({ monitorSupported: true }).level]) assert.equal(level, "good-to-know");
});

test("device names and kinds", () => {
  assert.equal(deviceKind({ ip: "1", ports: [554] }), "camera or recorder");
  assert.equal(deviceKind({ ip: "1", web: { title: "PIX-LINK" } }), "Wi-Fi extender or access point");
  assert.equal(deviceKind({ ip: "1", broadcasts: ["Upstairs"] }), "Wi-Fi extender or access point");
  assert.equal(deviceName({ ip: "192.168.50.9", hostname: "Galaxy-S21.lan" }), "Galaxy-S21 (192.168.50.9)");
  assert.equal(deviceName({ ip: "192.168.50.9", ports: [] }), "Device at 192.168.50.9");
  assert.equal(deviceName({ ...router, friendlyName: "Acme" }), "Your router (Acme)");
});

test("findings are sorted most important first, and the summary counts them", () => {
  const cam = { ip: "192.168.50.20", mac: "02:00:00:00:00:20", ports: [21, 23] };
  const fs = run({ devices: [router, cam], upnp: { devices: [{ ip: router.ip }], router: { found: false, mappings: [] } } });
  assert.deepEqual(fs.map((f) => f.level), [...fs.map((f) => f.level)].sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b)));
  assert.equal(summarize(fs), "1 to fix soon, 1 worth fixing. Everything else looks fine.");
  assert.equal(summarize([]), "Nothing needs fixing. A few notes are below if you're curious.");
});
