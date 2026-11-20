// Asks a camera's video service whether it would describe its stream without a password (RTSP DESCRIBE).
// It never sends a password and never downloads video: only the one-line answer is read.

import net from "node:net";

// Common stream paths of popular camera brands. Trying a handful of known paths is discovery, not guessing logins.
export const STREAM_PATHS = ["/", "/live", "/stream1", "/h264", "/Streaming/Channels/101", "/cam/realmonitor?channel=1&subtype=0", "/11"];

export function describe(host, port, path, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = "";
    const done = (status) => {
      sock.destroy();
      resolve(status);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      sock.write(`DESCRIBE rtsp://${host}:${port}${path} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: Porchlight\r\n\r\n`);
    });
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      const m = buf.match(/^RTSP\/1\.\d (\d{3})/);
      if (m) done(Number(m[1]));
    });
    sock.once("timeout", () => done(null));
    sock.once("error", () => done(null));
    sock.once("close", () => done(null));
  });
}

// Result: "open" (a stream answered 200 without a password), "protected" (401), or "unknown".
export async function checkRtsp(host, port) {
  let sawAuth = false;
  for (const path of STREAM_PATHS) {
    const status = await describe(host, port, path);
    if (status === 200) return { state: "open", path };
    if (status === 401) sawAuth = true;
    if (status === null) break; // the service stopped answering; don't keep knocking
  }
  return { state: sawAuth ? "protected" : "unknown" };
}
