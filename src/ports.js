// Checks which common "doors" (TCP ports) answer on each device. It only opens a connection and closes it again:
// no login, no data sent.

import net from "node:net";

// port -> what it means in plain words
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
};

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

// One door at a time per device: small devices (extenders, cameras) drop every connection when several arrive at
// once, which would both hide their open ports and disturb them. Different devices are checked in parallel.
export async function scanPorts(host, ports = Object.keys(COMMON_PORTS).map(Number), check = checkPort) {
  const open = [];
  for (const p of ports) if (await check(host, p)) open.push(p);
  return open;
}
