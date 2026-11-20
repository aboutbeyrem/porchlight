// Asks a device what it is, the way a browser would: loads its web page (if it has one) and reads the title and
// server name, and reads the greeting an FTP server sends to everyone who connects. Never logs in, never sends
// anything but a plain page request.
import net from "node:net";
import { httpRequest, pageTitle } from "./http.js";

const WEB_PORTS = [80, 8080, 8000, 8081];
// Titles that say nothing about what the device is.
const GENERIC = /^(log ?in|sign ?in|index|home|welcome|web ?(ui|page|server)?|untitled|document|redirect(ing)?|loading|\d{3}\b|router|default|main|configuration|setup)\b/i;

export function usefulTitle(title) {
  if (!title) return null;
  const t = title.replace(/^[\s.:|\-_*~]+|[\s.:|\-_*~]+$/g, "").trim();
  return t.length >= 2 && !GENERIC.test(t) ? t : null;
}

export async function webIdentity(ip, ports) {
  const port = WEB_PORTS.find((p) => ports.includes(p));
  if (!port) return null;
  let url = `http://${ip}:${port}/`;
  for (let hop = 0; hop < 3; hop++) {
    const res = await httpRequest(url, { timeoutMs: 2500, maxBytes: 64 * 1024 });
    if (!res) return null;
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      let next;
      try { next = new URL(loc, url); } catch { return null; }
      if (next.hostname !== ip || next.protocol !== "http:") break; // only follow redirects on the same device
      url = next.href;
      continue;
    }
    return { url: `http://${ip}${port === 80 ? "" : `:${port}`}/`, port, title: pageTitle(res.body), label: usefulTitle(pageTitle(res.body)), server: res.headers.server || null };
  }
  return { url: `http://${ip}${port === 80 ? "" : `:${port}`}/`, port, title: null, label: null, server: null };
}

// First line of the greeting a service sends on connect (FTP: "220 Welcome to Pure-FTPd").
export function readBanner(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let data = "";
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(data || null));
    sock.on("data", (c) => { data += c.toString("latin1"); if (data.includes("\n") || data.length > 512) done(data); });
    sock.on("error", () => done(null));
  });
}

export function ftpSoftware(banner) {
  if (!banner) return null;
  const m = banner.match(/(Pure-FTPd|vsFTPd|ProFTPD|FileZilla Server|Microsoft FTP Service|bftpd|BusyBox|GNU inetutils)/i);
  return m ? m[1] : null;
}
