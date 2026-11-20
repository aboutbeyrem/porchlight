// Address ranges an office can ask Porchlight to check, beyond the network this computer is on.
// Only private address space is allowed (RFC 1918: 10/8, 172.16/12, 192.168/16), never the public internet.
import net from "node:net";
import { ipToInt, intToIp } from "./network.js";
import { pool } from "./ports.js";

export const MAX_HOSTS = 4096;
const PRIVATE = [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]];

const inBlock = (ip, [base, bits]) => (ipToInt(ip) >>> (32 - bits)) === (ipToInt(base) >>> (32 - bits));
export const isPrivateIp = (ip) => net.isIPv4(ip) && PRIVATE.some((b) => inBlock(ip, b));

// "192.168.10.0/24", "10.0.5.7" (one host) or "10.0.5.10-10.0.5.40". Returns { cidr, hosts } or throws a plain error.
export function parseRange(text) {
  const t = String(text).trim();
  let first, last, label;
  let m;
  if ((m = t.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/))) {
    const bits = Number(m[2]);
    if (!net.isIPv4(m[1]) || bits > 32) throw new Error(`"${t}" isn't a valid range.`);
    if (bits < 20) throw new Error(`"${t}" is too big. Split it into ranges of /20 (4,094 addresses) or smaller.`);
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
    const base = (ipToInt(m[1]) & mask) >>> 0;
    const size = 2 ** (32 - bits);
    first = size > 2 ? base + 1 : base;
    last = size > 2 ? base + size - 2 : base + size - 1;
    label = `${intToIp(base)}/${bits}`;
  } else if ((m = t.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/))) {
    if (!net.isIPv4(m[1]) || !net.isIPv4(m[2])) throw new Error(`"${t}" isn't a valid range.`);
    first = ipToInt(m[1]);
    last = ipToInt(m[2]);
    if (last < first) throw new Error(`"${t}" ends before it starts.`);
    label = `${m[1]}-${m[2]}`;
  } else if (net.isIPv4(t)) {
    first = last = ipToInt(t);
    label = t;
  } else {
    throw new Error(`"${t}" isn't a range Porchlight understands. Use 192.168.10.0/24, 10.0.0.5 or 10.0.0.10-10.0.0.40.`);
  }
  if (!isPrivateIp(intToIp(first)) || !isPrivateIp(intToIp(last))) {
    throw new Error(`"${t}" includes public internet addresses. Porchlight only checks private networks (10.x, 172.16-31.x, 192.168.x).`);
  }
  if (last - first + 1 > MAX_HOSTS) throw new Error(`"${t}" has more than ${MAX_HOSTS} addresses.`);
  const hosts = [];
  for (let i = first; i <= last; i++) hosts.push(intToIp(i));
  return { cidr: label, hosts };
}

export function parseRanges(list) {
  const ranges = list.map(parseRange);
  const hosts = [...new Set(ranges.flatMap((r) => r.hosts))];
  if (hosts.length > MAX_HOSTS) throw new Error(`Those ranges add up to ${hosts.length} addresses; the limit for one checkup is ${MAX_HOSTS}.`);
  return { cidrs: ranges.map((r) => r.cidr), hosts };
}

// Is a host there? Routers don't pass on the "who has this address?" question used on the local network, so for
// other subnets Porchlight knocks on a few common doors. A refused connection still proves the host is there.
const KNOCK = [445, 80, 443, 22, 3389, 135, 8080, 9100, 5985, 554];
export function knock(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (alive) => { s.destroy(); resolve(alive); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", (e) => done(e.code === "ECONNREFUSED"));
  });
}

export async function tcpAlive(hosts, { timeoutMs = 600, concurrency = 64, onProgress = () => {} } = {}) {
  const alive = [];
  let done = 0;
  await pool(hosts, concurrency, async (ip) => {
    for (const p of KNOCK) {
      if (await knock(ip, p, timeoutMs)) { alive.push(ip); break; }
    }
    if (++done % 256 === 0) onProgress(done, hosts.length);
  });
  return alive.sort((a, b) => ipToInt(a) - ipToInt(b));
}
