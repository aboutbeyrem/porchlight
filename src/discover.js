// Finds the devices on the network: wakes every address with one tiny UDP packet (so the computer learns who is
// there), then reads the computer's own neighbour table. Nothing is sent to the devices beyond that one packet.
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { run, isWindows } from "./exec.js";

// Windows `arp -a`: "  192.168.1.1    a4-2b-b0-11-22-33    dynamic"
export function parseWindowsArp(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/i);
    if (m && m[3].toLowerCase() !== "static") out.push({ ip: m[1], mac: m[2].replace(/-/g, ":").toLowerCase() });
  }
  return out;
}

// Linux `ip -4 neigh`: "192.168.1.1 dev wlan0 lladdr a4:2b:b0:11:22:33 REACHABLE"
export function parseLinuxNeigh(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})\s+(\S+)/i);
    if (m && !/FAILED|INCOMPLETE/.test(m[3])) out.push({ ip: m[1], mac: m[2].toLowerCase() });
  }
  return out;
}

function isMulticastOrBroadcast(ip, mac) {
  const first = Number(ip.split(".")[0]);
  return first >= 224 || ip.endsWith(".255") || mac === "ff:ff:ff:ff:ff:ff" || mac.startsWith("01:00:5e");
}

async function wake(hosts, waitMs) {
  const sock = dgram.createSocket("udp4");
  await new Promise((r) => sock.bind(0, r));
  for (const ip of hosts) {
    await new Promise((r) => sock.send(Buffer.from([0]), 9, ip, () => r())); // port 9 = "discard"
  }
  sock.close();
  await new Promise((r) => setTimeout(r, waitMs)); // give the neighbour table time to fill
}

async function readTable(net) {
  return isWindows
    ? parseWindowsArp((await run("arp", ["-a", "-N", net.address])).stdout)
    : parseLinuxNeigh((await run("ip", ["-4", "neigh"])).stdout);
}

export async function discover(net) {
  // Two gentle passes: Wi-Fi devices in power-save mode often miss the first knock.
  const inRange = new Set(net.hosts);
  const found = new Map();
  const keep = (rows) => rows.filter((d) => inRange.has(d.ip) && !isMulticastOrBroadcast(d.ip, d.mac)).forEach((d) => found.set(d.ip, d));
  await wake(net.hosts, 1500);
  keep(await readTable(net));
  await wake(net.hosts.filter((ip) => !found.has(ip) && ip !== net.address), 2500);
  keep(await readTable(net));
  const devices = [...found.values()];
  devices.push({ ip: net.address, mac: "", self: true }); // this computer
  // Names from the router's DNS, when it has them ("Galaxy-S21", "ipcamera").
  await Promise.all(
    devices.map(async (d) => {
      try {
        const names = await Promise.race([dns.reverse(d.ip), new Promise((_, rej) => setTimeout(rej, 1500))]);
        d.hostname = names[0] || null;
      } catch {
        d.hostname = null;
      }
      d.isRouter = d.ip === net.gateway;
    })
  );
  return devices.sort((a, b) => Number(a.ip.split(".")[3]) - Number(b.ip.split(".")[3]));
}
