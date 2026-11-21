// Assembles the website for hosting: site/ plus a live demo of the panel at /demo (it shows the sample report of a
// made-up home and never scans anything), with strict security headers.
// Run: node scripts/build-site.js [https://your.site.url]   →  .site-build/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const out = path.join(root, ".site-build");
const url = (process.argv[2] || "").replace(/\/$/, "");

// Start clean, but keep the Vercel project link (.vercel) so redeploys go to the same project.
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f !== ".vercel") fs.rmSync(path.join(out, f), { recursive: true, force: true });
fs.mkdirSync(path.join(out, "demo"), { recursive: true });
fs.writeFileSync(path.join(out, ".vercelignore"), ".env*\n.vercel\n.gitignore\nREADME.txt\n"); // never upload tokens
for (const f of fs.readdirSync(path.join(root, "site"))) fs.copyFileSync(path.join(root, "site", f), path.join(out, f));
for (const f of ["index.html", "panel.css", "panel.js", "demo.json"]) fs.copyFileSync(path.join(root, "public", f), path.join(out, "demo", f));
// The Windows installer, when it has been built (app/: npx @tauri-apps/cli build), and the signed update manifest
// the app checks once a day. The app only installs an update whose signature matches the key built into it.
const version = JSON.parse(fs.readFileSync(path.join(root, "app", "src-tauri", "tauri.conf.json"), "utf8")).version;
const installerName = `Porchlight_${version}_x64-setup.exe`;
const installer = path.join(root, "app", "src-tauri", "target", "release", "bundle", "nsis", installerName);
let installerHash = "";
if (fs.existsSync(installer)) {
  fs.mkdirSync(path.join(out, "download"), { recursive: true });
  fs.copyFileSync(installer, path.join(out, "download", installerName));
  installerHash = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");
  const sig = installer + ".sig";
  if (url && fs.existsSync(sig)) {
    fs.mkdirSync(path.join(out, "updates"), { recursive: true });
    const notes = "A clearer Porchlight: one next step at a time, \"Is this yours?\" for new devices, and a check that your fix worked.";
    const manifest = { version, notes, pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), platforms: { "windows-x86_64": { signature: fs.readFileSync(sig, "utf8").trim(), url: `${url}/download/${installerName}` } } };
    fs.writeFileSync(path.join(out, "updates", "latest.json"), JSON.stringify(manifest, null, 2));
  }
}

// Absolute links for previews when the address is known.
let html = fs.readFileSync(path.join(out, "index.html"), "utf8");
// The download button and the checksum always match the installer being published.
html = html.replace(/Porchlight_[\d.]+_x64-setup\.exe/g, installerName).replace(/Download Porchlight [\d.]+ for Windows/g, `Download Porchlight ${version} for Windows`);
if (installerHash) html = html.replace(/<code class="hash">[0-9a-f]{64}<\/code>/, `<code class="hash">${installerHash}</code>`);
fs.writeFileSync(path.join(out, "index.html"), html);
if (url) {
  html = html.replace(`<meta property="og:image" content="panel-sample.png">`, `<meta property="og:image" content="${url}/panel-sample.png">\n  <meta property="og:url" content="${url}/">\n  <link rel="canonical" href="${url}/">`);
  fs.writeFileSync(path.join(out, "index.html"), html);
}
let demo = fs.readFileSync(path.join(out, "demo", "index.html"), "utf8");
demo = demo.replace(`<a href="/">Check your own network</a>`, `<a href="/#run">Get Porchlight to check your own network</a>`);
demo = demo.replace("<title>Porchlight</title>", "<title>Porchlight demo: a sample report of a made-up home</title>\n  <meta name=\"robots\" content=\"noindex\">");
fs.writeFileSync(path.join(out, "demo", "index.html"), demo);

// The only inline script is the tiny "start in the dark" switch: allow exactly that one by its hash.
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inline.map((s) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`);
const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(" ")}`.trim(),
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
const headers = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
];
// Links to older installers (in posts, READMEs) lead to the current one.
const redirects = ["0.5.0", "0.6.0", "0.6.1"].filter((v) => v !== version).map((v) => ({ source: `/download/Porchlight_${v}_x64-setup.exe`, destination: `/download/${installerName}`, permanent: false }));
fs.writeFileSync(path.join(out, "vercel.json"), JSON.stringify({ cleanUrls: true, trailingSlash: true, redirects, headers: [{ source: "/(.*)", headers }] }, null, 2));
console.log(`Built ${out}${url ? ` for ${url}` : ""} (${inline.length} inline script allowed by hash)`);
