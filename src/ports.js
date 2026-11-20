// Checks which common "doors" (TCP ports) answer on each device. It only opens a connection and closes it again:
// no login, no data sent.

import net from "node:net";

// port -> what it means in plain words. `office: true` ports are only checked in the office profile.
export const COMMON_PORTS = {
  21: { name: "FTP", plain: "old file transfer (no encryption)" },
  22: { name: "SSH", plain: "secure remote login" },
  23: { name: "Telnet", plain: "old remote login (no encryption)" },
  80: { name: "HTTP", plain: "web page (not encrypted)" },
  443: { name: "HTTPS", plain: "web page (encrypted)" },
  445: { name: "SMB", plain: "Windows file sharing" },
  554: { name: "RTSP", plain: "live video stream" },
  1883: { name: "MQTT", plain: "smart-home messages (not encrypted)" },
  2323: { name: "Telnet-alt", plain: "old remote login (no encryption)" },
  2375: { name: "Docker", plain: "Docker remote control (no encryption)" },
  3389: { name: "RDP", plain: "Windows remote desktop" },
  5555: { name: "ADB", plain: "Android debugging" },
  5900: { name: "VNC", plain: "remote screen control" },
  8000: { name: "HTTP-alt", plain: "web page (often cameras and recorders)" },
  8080: { name: "HTTP-alt", plain: "web page (often admin pages)" },
  8554: { name: "RTSP-alt", plain: "live video stream" },
  34567: { name: "XMEye", plain: "DVR/camera remote-viewing service" },
  37777: { name: "Dahua", plain: "Dahua camera/recorder service" },
  // Office profile: servers and management.
  389: { name: "LDAP", plain: "directory service (not encrypted)", office: true },
  1433: { name: "MSSQL", plain: "SQL Server database", office: true },
  3306: { name: "MySQL", plain: "MySQL / MariaDB database", office: true },
  5432: { name: "PostgreSQL", plain: "PostgreSQL database", office: true },
  5985: { name: "WinRM", plain: "Windows remote management (not encrypted)", office: true },
  5984: { name: "CouchDB", plain: "CouchDB database", office: true },
  6379: { name: "Redis", plain: "Redis database", office: true },
  8443: { name: "HTTPS-alt", plain: "web page (encrypted, often admin pages)", office: true },
  9100: { name: "JetDirect", plain: "raw printing", office: true },
  9200: { name: "Elasticsearch", plain: "Elasticsearch search database", office: true },
  11211: { name: "Memcached", plain: "Memcached cache", office: true },
  27017: { name: "MongoDB", plain: "MongoDB database", office: true },
};

export const PROFILES = {
  // Gentle: one door at a time, so small home devices keep working.
  home: { ports: Object.keys(COMMON_PORTS).map(Number).filter((p) => !COMMON_PORTS[p].office), perHost: 1, timeoutMs: 1200 },
  // Offices have sturdier devices and more of them: a few doors at a time, more doors.
  office: { ports: Object.keys(COMMON_PORTS).map(Number), perHost: 4, timeoutMs: 1000 },
};

export function portsFor(profile = "home", extra = []) {
  const base = (PROFILES[profile] || PROFILES.home).ports;
  return [...new Set([...base, ...extra.filter((p) => Number.isInteger(p) && p > 0 && p < 65536)])].sort((a, b) => a - b);
}

export function checkPort(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (open) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

// Runs tasks with at most `limit` in flight, so a home router is never flooded.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

// Home profile: one door at a time per device. Small devices (extenders, cameras) drop every connection when
// several arrive at once, which would both hide their open ports and disturb them. Devices run in parallel.
export async function scanPorts(host, ports = PROFILES.home.ports, check = checkPort, { perHost = 1, timeoutMs = 1200 } = {}) {
  const open = await pool(ports, perHost, async (p) => ((await check(host, p, timeoutMs)) ? p : null));
  return open.filter((p) => p !== null).sort((a, b) => a - b);
}
