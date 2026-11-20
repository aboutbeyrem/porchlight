// Protocol "hellos" that reveal how a service is configured without logging in. Each one sends only the opening
// message any client sends, reads the reply, and hangs up. No user name, no password, no session.
import net from "node:net";
import tls from "node:tls";

// Opens a connection, sends one message, collects the reply until `done(buf)` says it's complete.
export function exchange(host, port, payload, done, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let finished = false;
    const finish = (v) => { if (!finished) { finished = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs, () => finish(buf.length ? buf : null));
    sock.on("connect", () => sock.write(payload));
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (done(buf)) finish(buf); });
    sock.on("error", () => finish(buf.length ? buf : null));
    sock.on("close", () => finish(buf.length ? buf : null));
  });
}
const nbssComplete = (b) => b.length >= 4 && b.length >= 4 + b.readUIntBE(1, 3);
const nbss = (smb) => Buffer.concat([Buffer.from([0, (smb.length >> 16) & 255, (smb.length >> 8) & 255, smb.length & 255]), smb]);

// ---------- SMB (Windows file sharing) ----------
// SMB2 NEGOTIATE offering dialects 2.0.2 to 3.0.2. The reply says which dialect the server picked and whether it
// requires every message to be signed.
export function smb2NegotiateRequest() {
  const header = Buffer.alloc(64);
  header.write("fe534d42", 0, "hex"); // \xFE S M B
  header.writeUInt16LE(64, 4); // structure size
  header.writeUInt16LE(0, 12); // NEGOTIATE
  header.writeUInt16LE(1, 14); // credits requested
  header.writeUInt32LE(0xfeff, 32); // process id
  const dialects = [0x0202, 0x0210, 0x0300, 0x0302];
  const body = Buffer.alloc(36 + dialects.length * 2);
  body.writeUInt16LE(36, 0);
  body.writeUInt16LE(dialects.length, 2);
  body.writeUInt16LE(1, 4); // we can sign
  Buffer.from("506f7263686c6967687421506f726368", "hex").copy(body, 12); // client GUID ("Porchlight!Porch")
  dialects.forEach((d, i) => body.writeUInt16LE(d, 36 + i * 2));
  return nbss(Buffer.concat([header, body]));
}

const DIALECTS = { 0x0202: "2.0.2", 0x0210: "2.1", 0x0300: "3.0", 0x0302: "3.0.2", 0x0311: "3.1.1" };
export function parseSmb2Negotiate(buf) {
  if (!buf || buf.length < 4 + 64 + 6 || buf.toString("hex", 4, 8) !== "fe534d42") return null;
  if (buf.readUInt32LE(4 + 8) !== 0) return null; // status
  const body = 4 + 64;
  const securityMode = buf.readUInt16LE(body + 2);
  const dialect = buf.readUInt16LE(body + 4);
  return { dialect: DIALECTS[dialect] || `0x${dialect.toString(16)}`, signingEnabled: Boolean(securityMode & 1), signingRequired: Boolean(securityMode & 2) };
}

// SMB1 NEGOTIATE offering only "NT LM 0.12", the dialect of SMB version 1. A server with SMBv1 turned off refuses.
export function smb1NegotiateRequest() {
  const header = Buffer.alloc(32);
  header.write("ff534d42", 0, "hex"); // \xFF S M B
  header[4] = 0x72; // NEGOTIATE
  header[9] = 0x18; // flags: case-insensitive paths
  header.writeUInt16LE(0xc801, 10); // flags2: unicode, NT status, extended security, long names
  header.writeUInt16LE(0xfeff, 26); // process id
  const dialect = Buffer.concat([Buffer.from([0x02]), Buffer.from("NT LM 0.12\0", "latin1")]);
  const params = Buffer.alloc(3);
  params[0] = 0; // word count
  params.writeUInt16LE(dialect.length, 1);
  return nbss(Buffer.concat([header, params, dialect]));
}

export function parseSmb1Negotiate(buf) {
  if (!buf || buf.length < 4 + 32 + 3 || buf.toString("hex", 4, 8) !== "ff534d42" || buf[8] !== 0x72) return false;
  if (buf.readUInt32LE(4 + 5) !== 0) return false; // status
  const wordCount = buf[4 + 32];
  return wordCount >= 1 && buf.readUInt16LE(4 + 33) === 0; // the server picked our only dialect
}

export async function checkSmb(host, port = 445) {
  const v2 = parseSmb2Negotiate(await exchange(host, port, smb2NegotiateRequest(), nbssComplete));
  const v1 = parseSmb1Negotiate(await exchange(host, port, smb1NegotiateRequest(), nbssComplete));
  if (!v2 && !v1) return null;
  return { smb1: v1, ...(v2 || { dialect: null, signingEnabled: null, signingRequired: null }) };
}

// ---------- RDP (Windows Remote Desktop) ----------
// Asks to connect with plain TLS only, without Network Level Authentication (NLA). A server that insists on NLA
// answers "HYBRID_REQUIRED_BY_SERVER"; one that agrees lets anyone reach the Windows sign-in screen first.
export function rdpNegotiationRequest() {
  return Buffer.from("030000130ee000000000000100080001000000", "hex"); // TPKT + X.224 CR + RDP_NEG_REQ(PROTOCOL_SSL)
}

export function parseRdpNegotiation(buf) {
  if (!buf || buf.length < 11 || buf[0] !== 3 || (buf[5] & 0xf0) !== 0xd0) return null; // TPKT + connection confirm
  if (buf.length < 19) return { nla: false, protocol: "rdp" }; // old server: no negotiation at all, classic RDP security
  const type = buf[11];
  const value = buf.readUInt32LE(15);
  if (type === 2) return { nla: false, protocol: value === 0 ? "rdp" : value === 1 ? "tls" : `0x${value.toString(16)}` };
  if (type === 3) return { nla: value === 5 || value === 6, protocol: null, failure: value };
  return null;
}

export async function checkRdp(host, port = 3389) {
  return parseRdpNegotiation(await exchange(host, port, rdpNegotiationRequest(), (b) => b.length >= 4 && b.length >= b.readUInt16BE(2)));
}

// ---------- TLS (encrypted web pages and services) ----------
function handshake(host, port, opts, timeoutMs) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, ...opts });
    const finish = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => finish(null));
    sock.once("secureConnect", () => finish({ protocol: sock.getProtocol(), cert: sock.getPeerCertificate() }));
    sock.once("error", () => finish(null));
  });
}

export function describeCert(cert, now = Date.now()) {
  if (!cert || !cert.valid_to) return null;
  const expires = new Date(cert.valid_to);
  const name = (o) => (o ? o.CN || o.O || Object.values(o)[0] || null : null);
  const subject = name(cert.subject);
  const issuer = name(cert.issuer);
  return {
    subject,
    issuer,
    selfSigned: JSON.stringify(cert.subject) === JSON.stringify(cert.issuer),
    expires: expires.toISOString(),
    expired: expires.getTime() < now,
    daysLeft: Math.floor((expires.getTime() - now) / 86400000),
    bits: cert.bits || null,
  };
}

export async function checkTls(host, port = 443, timeoutMs = 3000) {
  const best = await handshake(host, port, {}, timeoutMs);
  if (!best) return null;
  // Does it still accept the retired versions? (Our side has to lower its own security level to even ask.)
  const old = [];
  for (const v of ["TLSv1", "TLSv1.1"]) {
    const r = await handshake(host, port, { minVersion: v, maxVersion: v, ciphers: "DEFAULT@SECLEVEL=0" }, timeoutMs);
    if (r) old.push(v.replace("TLSv", "TLS "));
  }
  return { protocol: best.protocol, cert: describeCert(best.cert), oldVersions: old };
}

// ---------- Databases that answer without a password ----------
// Redis: PING with no password. "+PONG" means anyone on the network can read and change its data; "-NOAUTH" means
// it asks for a password first. PING reads nothing and changes nothing.
export async function checkRedis(host, port = 6379) {
  const r = await exchange(host, port, Buffer.from("PING\r\n"), (b) => b.includes(0x0a), 2500);
  if (!r) return null;
  const line = r.toString("latin1").split("\r\n")[0];
  if (/^\+PONG/.test(line)) return { auth: false };
  if (/NOAUTH|WRONGPASS|Authentication required/i.test(line)) return { auth: true };
  if (/DENIED|protected mode/i.test(r.toString("latin1"))) return { auth: true, protectedMode: true };
  return null;
}

// MySQL / MariaDB send a greeting with their version to everyone who connects.
export function parseMysqlGreeting(buf) {
  if (!buf || buf.length < 6 || buf[4] === 0xff) return null;
  if (buf[4] !== 10) return null; // protocol version 10
  const end = buf.indexOf(0, 5);
  return end > 5 ? { version: buf.toString("latin1", 5, end) } : null;
}
export async function checkMysql(host, port = 3306) {
  return parseMysqlGreeting(await exchange(host, port, Buffer.alloc(0), (b) => b.length >= 4 && b.length >= 4 + b.readUIntLE(0, 3), 2500));
}

// Elasticsearch: its front page answers with the cluster name when security is off, or 401 when it's on.
export async function checkElastic(host, port = 9200) {
  const { httpRequest } = await import("./http.js");
  const r = await httpRequest(`http://${host}:${port}/`, { timeoutMs: 2500, maxBytes: 16384 });
  if (!r) return null;
  if (r.status === 401 || r.status === 403) return { auth: true };
  if (r.status === 200 && /"cluster_name"/.test(r.body)) {
    const v = r.body.match(/"number"\s*:\s*"([^"]+)"/);
    return { auth: false, version: v ? v[1] : null };
  }
  return null;
}
