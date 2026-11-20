// Tiny HTTP helpers with hard timeouts and size limits (devices on home networks can be slow or misbehave).
import http from "node:http";

export function httpRequest(url, { method = "GET", headers = {}, body = null, timeoutMs = 3000, maxBytes = 256 * 1024 } = {}) {
  return new Promise((resolve) => {
    let req;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      req = http.request(url, { method, headers }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > maxBytes) { // enough to read: keep what we have, stop downloading
            finish({ status: res.statusCode, headers: res.headers, body: data.slice(0, maxBytes) });
            req.destroy();
          }
        });
        res.on("end", () => finish({ status: res.statusCode, headers: res.headers, body: data }));
        res.on("error", () => finish(null));
      });
    } catch {
      return finish(null);
    }
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on("error", () => finish(null));
    if (body) req.write(body);
    req.end();
  });
}

export function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function pageTitle(html) {
  const m = (html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1]
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (all, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all))
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 80) : null;
}
