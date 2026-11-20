// The local panel only answers this computer, refuses other websites, and won't scan without consent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/server.js";

let server;
let port;
before(async () => {
  // createServer needs to know its port for the Host check, so pick a free one first.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  server = createServer(port);
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
});
after(() => server.close());

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("serves the panel with a strict content policy", async () => {
  const res = await request("/");
  assert.equal(res.status, 200);
  assert.match(res.body, /<title>Porchlight<\/title>/);
  assert.match(res.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("refuses requests that arrive under another name (DNS rebinding)", async () => {
  const res = await request("/api/status", { headers: { Host: "evil.example:7377" } });
  assert.equal(res.status, 403);
});

test("refuses a scan started by another website", async () => {
  const res = await request("/api/scan", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
  assert.equal(res.status, 403);
});

test("won't scan without consent", async () => {
  const res = await request("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.body).error, /confirm is yours/);
});

test("only serves files from the panel folder", async () => {
  for (const path of ["/../package.json", "/..%2fpackage.json", "/src/server.js", "/%2e%2e/package.json"]) {
    const res = await request(path);
    assert.equal(res.status, 404, path);
  }
});

test("bad JSON is an error, not a crash", async () => {
  const res = await request("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.equal(res.status, 500);
  const ok = await request("/api/status");
  assert.equal(ok.status, 200);
});
