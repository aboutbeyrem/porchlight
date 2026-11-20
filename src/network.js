// Finds the home network this computer is on: its own address, the router (gateway) and the range to check.
import os from "node:os";
import { run, isWindows } from "./exec.js";

export function ipToInt(ip) {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}
export function intToIp(n) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

// Windows `route print -4`: "  0.0.0.0  0.0.0.0  192.168.1.1  192.168.1.50  25" (gateway, interface, metric)
export function parseWindowsRoutes(text) {
  const routes = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/);
    if (m) routes.push({ gateway: m[1], address: m[2], metric: Number(m[3]) });
  }
  return routes.sort((a, b) => a.metric - b.metric)[0] || null;
}

// Linux `ip -4 route show default`: "default via 192.168.1.1 dev wlan0 proto dhcp src 192.168.1.50 metric 600"
export function parseLinuxRoutes(text) {
  const routes = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/default via (\d+\.\d+\.\d+\.\d+) dev (\S+)(?:.*?src (\d+\.\d+\.\d+\.\d+))?(?:.*?metric (\d+))?/);
    if (m) routes.push({ gateway: m[1], dev: m[2], address: m[3] || null, metric: Number(m[4] || 0) });
  }
  return routes.sort((a, b) => a.metric - b.metric)[0] || null;
}

// The addresses to look at: the whole subnet when it's a /24 or smaller, otherwise the /24 around us (home networks
// are almost always /24; a bigger range is probably not a home network and would take too long).
export function hostsToCheck(address, prefix) {
  const usePrefix = Math.max(prefix, 24);
  const mask = usePrefix === 32 ? 0xffffffff : (~((1 << (32 - usePrefix)) - 1)) >>> 0;
  const base = (ipToInt(address) & mask) >>> 0;
  const size = 2 ** (32 - usePrefix);
  const hosts = [];
  for (let i = 1; i < size - 1; i++) hosts.push(intToIp(base + i));
  return { hosts, cidr: `${intToIp(base)}/${usePrefix}`, narrowed: usePrefix !== prefix };
}

export async function findNetwork() {
  let route = null;
  if (isWindows) route = parseWindowsRoutes((await run("route", ["print", "-4", "0.0.0.0"])).stdout);
  else route = parseLinuxRoutes((await run("ip", ["-4", "route", "show", "default"])).stdout);
  if (!route) return null;

  // Match the route to an interface to learn its address and prefix length.
  let iface = null;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const matches = route.address ? a.address === route.address : name === route.dev;
      if (matches) iface = { name, address: a.address, prefix: Number(a.cidr.split("/")[1]), mac: a.mac };
    }
  }
  if (!iface) return null;
  const range = hostsToCheck(iface.address, iface.prefix);
  return { interface: iface.name, address: iface.address, prefix: iface.prefix, gateway: route.gateway, ...range };
}
