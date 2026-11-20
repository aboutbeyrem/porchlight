// Network code against small fake devices running on this computer (127.0.0.1 only).
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { checkPort, scanPorts } from "../src/ports.js";
import { checkRtsp } from "../src/rtsp.js";
import { readBanner, ftpSoftware, usefulTitle } from "../src/identify.js";
import { httpRequest, pageTitle } from "../src/http.js";

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

// A fake camera: answers RTSP DESCRIBE with a fixed status and remembers every request.
function fakeCamera(status) {
  const requests = [];
  const server = net.createServer((sock) => {
    sock.on("data", (d) => {
      requests.push(d.toString());
      sock.write(`RTSP/1.0 ${status} ${status === 200 ? "OK" : "Unauthorized"}\r\nCSeq: 1\r\n\r\n`);
    });
  });
  return { server, requests };
}

test("an RTSP camera that shares video without a password is 'open'", async () => {
  const cam = fakeCamera(200);
  const port = await listen(cam.server);
  assert.deepEqual(await checkRtsp("127.0.0.1", port), { state: "open", path: "/" });
  assert.doesNotMatch(cam.requests.join(""), /Authorization/i, "never sends a password");
  cam.server.close();
});

test("an RTSP camera that asks for a password is 'protected'", async () => {
  const cam = fakeCamera(401);
  const port = await listen(cam.server);
  assert.deepEqual(await checkRtsp("127.0.0.1", port), { state: "protected" });
  cam.server.close();
});

test("open and closed ports", async () => {
  const server = net.createServer((s) => s.end());
  const port = await listen(server);
  assert.equal(await checkPort("127.0.0.1", port), true);
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await checkPort("127.0.0.1", port), false);
});

test("ports are checked one at a time per device", async () => {
  let inFlight = 0;
  let most = 0;
  const slowCheck = async (host, port) => {
    most = Math.max(most, ++inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return port % 2 === 0;
  };
  assert.deepEqual(await scanPorts("127.0.0.1", [21, 22, 23, 80], slowCheck), [22, 80]);
  assert.equal(most, 1);
});

test("an FTP greeting names the software without logging in", async () => {
  let received = "";
  const server = net.createServer((s) => {
    s.write("220---------- Welcome to Pure-FTPd [privsep] ----------\r\n");
    s.on("data", (d) => (received += d));
  });
  const port = await listen(server);
  try {
    assert.equal(ftpSoftware(await readBanner("127.0.0.1", port)), "Pure-FTPd");
    assert.equal(received, "", "nothing is sent to the FTP server");
  } finally {
    server.close();
  }
});

test("big pages are cut short, not dropped", async () => {
  const server = http.createServer((req, res) => res.end(`<title>Big</title>${"x".repeat(300000)}`));
  const port = await listen(server);
  const res = await httpRequest(`http://127.0.0.1:${port}/`, { maxBytes: 1000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1000);
  assert.equal(pageTitle(res.body), "Big");
  server.close();
});

test("page titles: decoded, and generic ones are ignored", () => {
  assert.equal(pageTitle("<title> Tom &amp; Jerry&#39;s cam </title>"), "Tom & Jerry's cam");
  assert.equal(usefulTitle("PIX-LINK"), "PIX-LINK");
  assert.equal(usefulTitle(".::Welcome to the Web-Based Configurator::."), null);
  assert.equal(usefulTitle("Login"), null);
  assert.equal(usefulTitle("302 Found"), null);
});
