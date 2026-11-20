// Office features: protocol checks against fake servers on 127.0.0.1, the check catalog, policies, ranges and
// report files.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  checkSmb, parseSmb2Negotiate, parseSmb1Negotiate, smb2NegotiateRequest, smb1NegotiateRequest,
  checkRdp, parseRdpNegotiation, checkRedis, parseMysqlGreeting, describeCert,
} from "../src/protocols.js";
import { annotate, CHECKS, checkFor, catalogMarkdown } from "../src/catalog.js";
import { validatePolicy, applyAccepted, failsPolicy, knownName } from "../src/policy.js";
import { parseRange, parseRanges, isPrivateIp, knock } from "../src/ranges.js";
import { toCsv, toHtml, toMarkdown } from "../src/report.js";
import { buildFindings, serviceFindings, inventoryFindings, scoreOf } from "../src/findings.js";
import { portsFor } from "../src/ports.js";

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

// ---------- fake SMB server ----------
function smb2Reply({ dialect = 0x0302, securityMode = 1 } = {}) {
  const h = Buffer.alloc(64);
  h.write("fe534d42", 0, "hex");
  h.writeUInt16LE(64, 4);
  const body = Buffer.alloc(65);
  body.writeUInt16LE(65, 0);
  body.writeUInt16LE(securityMode, 2);
  body.writeUInt16LE(dialect, 4);
  const smb = Buffer.concat([h, body]);
  return Buffer.concat([Buffer.from([0, 0, smb.length >> 8, smb.length & 255]), smb]);
}
function smb1Reply() {
  const h = Buffer.alloc(32);
  h.write("ff534d42", 0, "hex");
  h[4] = 0x72;
  const params = Buffer.from([17, 0, 0]); // word count 17, dialect index 0
  const smb = Buffer.concat([h, params, Buffer.alloc(34)]);
  return Buffer.concat([Buffer.from([0, 0, smb.length >> 8, smb.length & 255]), smb]);
}
function fakeSmb({ smb1 = false, securityMode = 1 } = {}) {
  return net.createServer((s) => s.on("data", (d) => {
    if (d.toString("hex", 4, 8) === "fe534d42") s.write(smb2Reply({ securityMode }));
    else if (d.toString("hex", 4, 8) === "ff534d42") smb1 ? s.write(smb1Reply()) : s.destroy();
  }));
}

test("SMB: request shapes", () => {
  const r2 = smb2NegotiateRequest();
  assert.equal(r2.toString("hex", 4, 8), "fe534d42");
  assert.equal(r2.readUIntBE(1, 3), r2.length - 4);
  const r1 = smb1NegotiateRequest();
  assert.equal(r1.toString("hex", 4, 8), "ff534d42");
  assert.match(r1.toString("latin1"), /NT LM 0\.12/);
  assert.equal(parseSmb2Negotiate(Buffer.alloc(10)), null);
  assert.equal(parseSmb1Negotiate(null), false);
});

test("SMB: a server that still speaks SMBv1, without required signing", async () => {
  const server = fakeSmb({ smb1: true, securityMode: 1 });
  const port = await listen(server);
  try {
    assert.deepEqual(await checkSmb("127.0.0.1", port), { smb1: true, dialect: "3.0.2", signingEnabled: true, signingRequired: false });
  } finally { server.close(); }
});

test("SMB: a modern server with signing required and SMBv1 off", async () => {
  const server = fakeSmb({ smb1: false, securityMode: 3 });
  const port = await listen(server);
  try {
    assert.deepEqual(await checkSmb("127.0.0.1", port), { smb1: false, dialect: "3.0.2", signingEnabled: true, signingRequired: true });
  } finally { server.close(); }
});

// ---------- fake RDP server ----------
test("RDP: NLA required vs not required", async () => {
  const reply = (type, value) => {
    const neg = Buffer.alloc(8);
    neg[0] = type;
    neg.writeUInt16LE(8, 2);
    neg.writeUInt32LE(value, 4);
    const x224 = Buffer.concat([Buffer.from([0x0e, 0xd0, 0, 0, 0x12, 0x34, 0]), neg]);
    return Buffer.concat([Buffer.from([3, 0, 0, 4 + x224.length]), x224]);
  };
  assert.deepEqual(parseRdpNegotiation(reply(2, 1)), { nla: false, protocol: "tls" });
  assert.deepEqual(parseRdpNegotiation(reply(3, 5)), { nla: true, protocol: null, failure: 5 });
  const server = net.createServer((s) => s.on("data", () => s.write(reply(2, 1))));
  const port = await listen(server);
  try { assert.deepEqual(await checkRdp("127.0.0.1", port), { nla: false, protocol: "tls" }); } finally { server.close(); }
});

// ---------- fake Redis ----------
test("Redis: PONG without a password, NOAUTH with one, and nothing else is sent", async () => {
  for (const [answer, expected] of [["+PONG\r\n", { auth: false }], ["-NOAUTH Authentication required.\r\n", { auth: true }]]) {
    let got = "";
    const server = net.createServer((s) => s.on("data", (d) => { got += d; s.write(answer); }));
    const port = await listen(server);
    try {
      assert.deepEqual(await checkRedis("127.0.0.1", port), expected);
      assert.equal(got, "PING\r\n");
    } finally { server.close(); }
  }
});

test("MySQL greeting and certificate details", () => {
  const body = Buffer.concat([Buffer.from([10]), Buffer.from("8.0.36\0", "latin1"), Buffer.alloc(20)]);
  assert.deepEqual(parseMysqlGreeting(Buffer.concat([Buffer.from([body.length, 0, 0, 0]), body])), { version: "8.0.36" });
  assert.equal(parseMysqlGreeting(Buffer.from([5, 0, 0, 0, 0xff, 1, 2, 3, 4])), null);
  const c = describeCert({ subject: { CN: "printer" }, issuer: { CN: "printer" }, valid_to: "Jan  1 00:00:00 2026 GMT", bits: 1024 }, Date.parse("2026-11-20"));
  assert.equal(c.selfSigned, true);
  assert.equal(c.expired, true);
  assert.equal(c.bits, 1024);
});

// ---------- findings from those checks ----------
const router = { ip: "10.0.0.1", mac: "02:00:00:00:00:01", isRouter: true, ports: [] };
test("office service findings and their levels", () => {
  const server = {
    ip: "10.0.0.20", mac: "02:00:00:00:00:20", netbios: { name: "FILESRV" }, ports: [445, 3389, 6379, 9200, 11211, 5432, 443],
    smb: { smb1: true, dialect: "3.0.2", signingEnabled: true, signingRequired: false },
    rdp: { nla: false, protocol: "tls" },
    redis: { auth: false },
    elastic: { auth: false, version: "7.10.2" },
    tls: { 443: { protocol: "TLSv1.2", oldVersions: ["TLS 1.0"], cert: { subject: "filesrv", issuer: "filesrv", selfSigned: true, expires: "2026-01-01T00:00:00.000Z", expired: true, daysLeft: -300, bits: 1024 } } },
  };
  const office = annotate(buildFindings({ devices: [router, server], profile: "office" }), [router, server]);
  const ids = office.map((f) => `${f.id}:${f.severity}`);
  for (const want of ["PL-REDIS-NOAUTH:high", "PL-ELASTIC-NOAUTH:high", "PL-SMB1:medium", "PL-SMB-SIGNING:medium", "PL-RDP-NLA:medium", "PL-TLS-OLD:medium", "PL-CERT-EXPIRED:medium", "PL-MEMCACHED:medium", "PL-DB-REACHABLE:low", "PL-CERT-WEAKKEY:low"]) {
    assert.ok(ids.includes(want), `missing ${want} in ${ids.join(", ")}`);
  }
  assert.ok(office.find((f) => f.id === "PL-SMB1").technical.includes("SMBv1 accepted"));
  assert.ok(!ids.some((x) => x.startsWith("PL-CERT-SELFSIGNED")), "an expired certificate is reported once, as expired");
  const valid = { ...server, tls: { 443: { ...server.tls[443], cert: { ...server.tls[443].cert, expired: false, daysLeft: 200 } } } };
  assert.ok(buildFindings({ devices: [valid], profile: "office" }).some((f) => f.title === "Self-signed security certificate"));
  // Home profile: no signing, certificate or database-reachability noise.
  const home = annotate(buildFindings({ devices: [router, server], profile: "home" }), [router, server]).map((f) => f.id);
  for (const no of ["PL-SMB-SIGNING", "PL-CERT-EXPIRED", "PL-CERT-SELFSIGNED", "PL-DB-REACHABLE"]) assert.ok(!home.includes(no), `home shouldn't report ${no}`);
  assert.ok(home.includes("PL-SMB1") && home.includes("PL-RDP-NLA"));
});

test("Remote Desktop forwarded to the internet without NLA is critical", () => {
  const pc = { ip: "10.0.0.30", mac: "02:00:00:00:00:30", ports: [3389], rdp: { nla: false, protocol: "rdp" } };
  const fs = annotate(serviceFindings(pc, "PC", "home", [{ enabled: true, internalClient: pc.ip, internalPort: 3389 }]), [pc]);
  assert.equal(fs[0].severity, "critical");
  assert.equal(fs[0].level, "fix-soon");
});

// ---------- catalog ----------
test("every finding Porchlight can produce has a catalog ID", () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  assert.equal(ids.size, CHECKS.length, "IDs are unique");
  const titles = [
    "Old remote-login service (Telnet) is on", "Android debugging is open to the network", "Docker can be controlled over the network without a password",
    'WPS is on for "X"', 'WPS is off on "X"', "Your Wi-Fi \"X\" has no password", "Your 3 Wi-Fi networks are well protected", "Your Wi-Fi \"X\" is well protected",
    "A network with no password is using your Wi-Fi's name", "Another access point uses your Wi-Fi's name", "No copies of your Wi-Fi nearby",
    "A new device joined your network", "3 new devices joined your network", "Fixed since your last checkup", "2 things fixed since your last checkup",
    "Device is not on your list of known devices", "4 devices are not on your list of known devices", "Your ALFA Wi-Fi adapter is in monitor mode",
    "Your ALFA Wi-Fi adapter can do monitor mode (it's off)", "Make sure the camera has its own admin password", "This computer's firewall is off",
  ];
  for (const t of titles) assert.ok(checkFor(t), `no catalog entry for "${t}"`);
  assert.match(catalogMarkdown(), /\| `PL-SMB1` \|/);
});

// ---------- policy ----------
test("policy: validation explains every problem in plain words", () => {
  assert.throws(() => validatePolicy({ profile: "bank", ranges: ["8.8.8.0/24"], accepted: [{ id: "x" }], knownDevices: [{ mac: "nope" }] }), (e) => {
    assert.match(e.message, /5 problems/);
    assert.match(e.message, /authorizedBy/);
    assert.match(e.message, /public internet/);
    assert.match(e.message, /"profile" must be/);
    return true;
  });
  assert.throws(() => validatePolicy({ ranges: ["10.0.0.0/24"] }), /authorizedBy/);
  const p = validatePolicy({ profile: "office", ranges: ["10.0.0.0/24"], authorizedBy: "IT", knownDevices: [{ mac: "AA-BB-CC-DD-EE-01", name: "Printer" }] });
  assert.equal(p.knownDevices[0].mac, "aa:bb:cc:dd:ee:01");
  assert.equal(knownName(p, { mac: "AA:BB:CC:DD:EE:01", ip: "10.0.0.9" }), "Printer");
});

test("policy: accepted risks leave the score and exit code, until their date", () => {
  const ftp = { level: "worth-fixing", id: "PL-FTP", device: "10.0.0.1", title: "Old file-sharing service (FTP) is on", fix: [] };
  const telnet = { level: "fix-soon", id: "PL-TELNET", device: "10.0.0.2", title: "Old remote-login service (Telnet) is on", fix: [] };
  const policy = { accepted: [{ id: "PL-FTP", device: "10.0.0.1", reason: "USB share", until: "2099-01-01" }, { id: "PL-TELNET", reason: "old", until: "2020-01-01" }] };
  const fs = applyAccepted([ftp, telnet].map((f) => ({ ...f })), [], policy);
  assert.equal(fs[0].accepted.reason, "USB share");
  assert.equal(fs[1].accepted, undefined);
  assert.equal(fs[1].acceptanceExpired.until, "2020-01-01");
  assert.equal(scoreOf(fs).value, 75);
  assert.equal(failsPolicy(fs, "fix-soon"), true);
  assert.equal(failsPolicy([fs[0]], "worth-fixing"), false);
  assert.equal(failsPolicy(fs, null), false);
});

test("policy: unknown devices are grouped into one finding", () => {
  const devices = [{ ip: "10.0.0.7", self: true }, { ip: "10.0.0.8", mac: "02:00:00:00:00:08", knownName: "NAS" }, { ip: "10.0.0.9", mac: "02:00:00:00:00:09" }, { ip: "10.0.0.10", mac: "02:00:00:00:00:10" }];
  const [f] = inventoryFindings(devices, { profile: "office", knownDevices: [{ mac: "02:00:00:00:00:08" }] });
  assert.equal(f.title, "2 devices are not on your list of known devices");
  assert.equal(f.level, "worth-fixing");
  assert.match(f.technical, /10\.0\.0\.9 02:00:00:00:00:09/);
  assert.deepEqual(inventoryFindings(devices, null), []);
});

// ---------- ranges ----------
test("ranges: private only, sensible sizes", () => {
  assert.equal(parseRange("192.168.10.0/24").hosts.length, 254);
  assert.equal(parseRange("10.0.0.5").hosts.length, 1);
  assert.equal(parseRange("10.0.0.10-10.0.0.40").hosts.length, 31);
  assert.equal(parseRange("172.20.0.0/20").hosts.length, 4094);
  for (const bad of ["8.8.8.0/24", "172.32.0.0/24", "192.167.255.0/24", "100.64.0.0/24", "10.0.0.0/8", "10.0.0.40-10.0.0.10", "banana"]) assert.throws(() => parseRange(bad), undefined, bad);
  assert.throws(() => parseRanges(["10.0.0.0/20", "10.1.0.0/20"]), /limit/);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.15.255.255"), false);
});

test("ranges: a refused connection still means the host is there", async () => {
  const server = net.createServer();
  const port = await listen(server);
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await knock("127.0.0.1", port, 1000), true);
});

test("office profile checks more ports", () => {
  assert.ok(!portsFor("home").includes(3306));
  assert.ok(portsFor("office").includes(3306));
  assert.deepEqual(portsFor("home", [8081, 99999, -1]).filter((p) => p === 8081 || p === 99999), [8081]);
});

// ---------- reports ----------
const report = {
  when: "2026-11-20T10:00:00.000Z", durationSec: 30, profile: "office", organization: "Acme <Test>", scope: ["10.0.0.0/24"],
  authorization: { by: "Jane", ranges: ["10.0.0.0/24"] }, score: { value: 65, label: "Needs some attention" }, changes: null,
  devices: [{ ip: "10.0.0.1", name: "Router", kind: "router", doors: [{ name: "HTTP", port: 80 }], mac: "02:00:00:00:00:01" }],
  findings: [
    { level: "fix-soon", severity: "high", id: "PL-TELNET", title: "Old remote-login service (Telnet) is on", deviceName: "Router", device: "10.0.0.1", found: "=HYPERLINK(\"x\") <script>", means: "m", likely: "l", fix: ["a", "b"], cis: ["4.8"], refs: ["CWE-319"], technical: "10.0.0.1 TCP/23 open" },
    { level: "worth-fixing", severity: "medium", id: "PL-FTP", title: "Old file-sharing service (FTP) is on", found: "f", means: "m", likely: "l", fix: ["a"], accepted: { reason: "needed", until: "2027-01-01" } },
    { level: "all-good", severity: "pass", id: "PL-FIREWALL-OK", title: "This computer's firewall is on", found: "f", means: "m", likely: "l", fix: [] },
  ],
};

test("HTML report: escaped, self-contained, separates accepted risks", () => {
  const h = toHtml(report);
  assert.ok(!h.includes("<script>"), "content is escaped");
  assert.ok(!/<script|src=["']http/i.test(h), "no scripts, no outside resources");
  assert.match(h, /Acme &lt;Test&gt;/);
  assert.match(h, /Accepted risks \(1\)/);
  assert.match(h, /Open findings \(1\)/);
  assert.match(h, /Authorised by<\/dt><dd>Jane/);
});

test("CSV report: one row per finding, formulas neutralised", () => {
  const rows = toCsv(report).trim().split("\r\n");
  assert.equal(rows.length, 4);
  assert.match(rows[1], /^PL-TELNET,high,fix-soon,open,/);
  assert.match(rows[1], /"'=HYPERLINK\(""x""\) <script>"/);
  assert.match(rows[2], /,accepted,/);
  assert.match(toMarkdown(report), /### High: Old remote-login service \(Telnet\) is on `PL-TELNET`/);
});
