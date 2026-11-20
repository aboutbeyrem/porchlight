// The local panel. Listens only on 127.0.0.1, refuses requests from other sites (Host/Origin checks against DNS
// rebinding), and keeps every result in memory on this computer.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findNetwork } from "./network.js";
import { wifiSurvey } from "./wifi.js";
import { runCheckup } from "./scan.js";
import { render } from "./report.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

export function createServer(port, { policy = null } = {}) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  let state = { status: "idle", progress: "", report: null, error: null };

  const send = (res, code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    if (!allowedHosts.has(req.headers.host || "")) return send(res, 403, { error: "Porchlight only answers on localhost." });
    if (req.method === "POST" && req.headers.origin && !allowedHosts.has(new URL(req.headers.origin).host)) return send(res, 403, { error: "Cross-site request refused." });
    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (req.method === "GET" && url.pathname === "/api/context") {
        const [net, wifi] = await Promise.all([findNetwork(), wifiSurvey({ beacons: false })]);
        const connected = wifi.adapters.find((a) => a.connected);
        return send(res, 200, {
          network: net ? { cidr: net.cidr, gateway: net.gateway, address: net.address, interface: net.interface } : null,
          connectedSsid: connected?.ssid || null,
          visibleSsids: [...new Set(wifi.networks.map((n) => n.ssid).filter(Boolean))],
          policy: policy && { organization: policy.organization, profile: policy.profile, ranges: policy.ranges, authorizedBy: policy.authorizedBy, knownDevices: policy.knownDevices.length, accepted: policy.accepted.length },
        });
      }
      if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, state);
      if (req.method === "POST" && url.pathname === "/api/scan") {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
        const { consent, homeSsid, profile } = JSON.parse(body || "{}");
        if (consent !== true) return send(res, 400, { error: "Porchlight only checks a network you confirm is yours." });
        if (profile != null && !["home", "office"].includes(profile)) return send(res, 400, { error: "Unknown profile." });
        if (state.status === "running") return send(res, 409, { error: "A checkup is already running." });
        state = { status: "running", progress: "Starting", report: null, error: null };
        runCheckup({ homeSsid: typeof homeSsid === "string" && homeSsid ? homeSsid.slice(0, 64) : null, profile: profile || policy?.profile || "home", policy, onProgress: (p) => (state.progress = p) })
          .then((report) => (state = { status: "done", progress: "", report, error: null }))
          .catch((e) => (state = { status: "error", progress: "", report: null, error: e.message }));
        return send(res, 202, { started: true });
      }
      const dl = url.pathname.match(/^\/api\/report\.(html|csv|md|json)$/);
      if (req.method === "GET" && dl) {
        if (state.status !== "done") return send(res, 404, { error: "Run a checkup first." });
        const type = { html: "text/html; charset=utf-8", csv: "text/csv; charset=utf-8", md: "text/markdown; charset=utf-8", json: "application/json; charset=utf-8" }[dl[1]];
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Disposition": `attachment; filename="porchlight-report-${state.report.when.slice(0, 10)}.${dl[1]}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        });
        return res.end(render(state.report, dl[1]));
      }
      if (req.method === "GET") {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!/^[\w.-]+$/.test(file)) return send(res, 404, { error: "Not found" });
        const data = await readFile(path.join(PUBLIC, file)).catch(() => null);
        if (!data) return send(res, 404, { error: "Not found" });
        return send(res, 200, data.toString("utf8"), TYPES[path.extname(file)] || "text/plain; charset=utf-8");
      }
      send(res, 405, { error: "Method not allowed" });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });
}

export function startServer(port = Number(process.env.PORCHLIGHT_PORT) || 7377, options = {}) {
  const server = createServer(port, options);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Porchlight is running. Open http://localhost:${port} in your browser.`);
    console.log("It only checks the network this computer is on, and nothing leaves this computer. Press Ctrl+C to stop.");
  });
  return server;
}
