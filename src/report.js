// Report files: a self-contained HTML report (no scripts, prints cleanly), CSV for spreadsheets and ticketing,
// and Markdown for wikis and tickets.
import { SEVERITY } from "./catalog.js";
import { LEVEL_LABEL } from "./findings.js";

export const VERSION = "0.4.0";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info", pass: "Pass" };
const bySeverity = (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity];
const when = (iso) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function sorted(report) {
  const open = report.findings.filter((f) => !f.accepted && f.level !== "all-good").sort(bySeverity);
  const accepted = report.findings.filter((f) => f.accepted).sort(bySeverity);
  const passed = report.findings.filter((f) => f.level === "all-good");
  return { open, accepted, passed };
}

export function counts(report) {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of report.findings) if (!f.accepted && f.severity in c) c[f.severity]++;
  return c;
}

// ---------- CSV ----------
const csvCell = (v) => {
  let s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(report) {
  const head = ["id", "severity", "level", "status", "title", "device", "ip", "found", "means", "likely", "fix", "technical", "cis_v8", "references", "accepted_reason", "accepted_until", "checked_at"];
  const rows = report.findings.map((f) => [
    f.id, f.severity, f.level, f.accepted ? "accepted" : f.level === "all-good" ? "pass" : "open", f.title, f.deviceName, f.device, f.found, f.means, f.likely,
    f.fix.map((s, i) => `${i + 1}. ${s}`).join(" "), f.technical, f.cis?.map((c) => `CIS ${c}`), f.refs, f.accepted?.reason, f.accepted?.until, report.when,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------- Markdown ----------
export function toMarkdown(report) {
  const { open, accepted, passed } = sorted(report);
  const c = counts(report);
  const L = [];
  L.push(`# Porchlight report${report.organization ? `: ${report.organization}` : ""}`, "");
  L.push(`- **Checked:** ${when(report.when)}, ${report.durationSec} s, ${report.devices.length} devices`);
  L.push(`- **Scope:** ${report.scope.join(", ")} (${report.profile} profile)`);
  if (report.authorization) L.push(`- **Authorised by:** ${report.authorization.by}`);
  L.push(`- **Score:** ${report.score.value}/100 (${report.score.label})`);
  L.push(`- **Open findings:** ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low`, "");
  const section = (title, list) => {
    if (!list.length) return;
    L.push(`## ${title}`, "");
    for (const f of list) {
      L.push(`### ${SEV_LABEL[f.severity]}: ${f.title} \`${f.id}\``, "");
      if (f.deviceName) L.push(`**Device:** ${f.deviceName}  `);
      L.push(`**What we found:** ${f.found}  `, `**What that means:** ${f.means}  `, `**How likely it matters:** ${f.likely}`, "");
      if (f.fix.length) L.push("**How to fix it:**", "", ...f.fix.map((s, i) => `${i + 1}. ${s}`), "");
      if (f.technical) L.push(`**Technical:** ${f.technical}  `);
      if (f.cis?.length || f.refs?.length) L.push(`**References:** ${[...(f.cis || []).map((x) => `CIS v8 ${x}`), ...(f.refs || [])].join(", ")}  `);
      if (f.accepted) L.push(`**Accepted:** ${f.accepted.reason}${f.accepted.by ? ` (${f.accepted.by})` : ""}${f.accepted.until ? `, until ${f.accepted.until}` : ""}  `);
      L.push("");
    }
  };
  section("Open findings", open);
  section("Accepted risks", accepted);
  if (passed.length) L.push("## Checks that passed", "", ...passed.map((f) => `- ${f.title} \`${f.id}\``), "");
  L.push("## Devices", "", "| Device | Address | Type | Open services |", "|---|---|---|---|");
  for (const d of report.devices) L.push(`| ${d.name.replace(/\|/g, "/")} | ${d.ip} | ${d.kind} | ${(d.doors || []).map((x) => `${x.name} ${x.port}`).join(", ") || "none"} |`);
  L.push("", `_Porchlight ${VERSION}. Looks, never breaks in: no logins, no password guessing, nothing sent anywhere._`, "");
  return L.join("\n");
}

// ---------- HTML ----------
export function toHtml(report) {
  const { open, accepted, passed } = sorted(report);
  const c = counts(report);
  const card = (f) => `
    <article class="f s-${f.severity}">
      <header><span class="sev">${SEV_LABEL[f.severity]}</span><h3>${esc(f.title)}</h3><code>${esc(f.id)}</code></header>
      ${f.deviceName ? `<p class="dev">${esc(f.deviceName)}</p>` : ""}
      <dl>
        <dt>What we found</dt><dd>${esc(f.found)}</dd>
        <dt>What that means</dt><dd>${esc(f.means)}</dd>
        <dt>How likely it matters</dt><dd>${esc(f.likely)}</dd>
        ${f.fix.length ? `<dt>How to fix it${f.minutes ? ` (about ${f.minutes} min)` : ""}</dt><dd><ol>${f.fix.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></dd>` : ""}
        ${f.technical ? `<dt>Technical</dt><dd class="mono">${esc(f.technical)}</dd>` : ""}
        ${f.cis?.length || f.refs?.length ? `<dt>References</dt><dd>${esc([...(f.cis || []).map((x) => `CIS Controls v8 ${x}`), ...(f.refs || [])].join(", "))}</dd>` : ""}
        ${f.accepted ? `<dt>Accepted risk</dt><dd>${esc(f.accepted.reason)}${f.accepted.by ? ` (${esc(f.accepted.by)})` : ""}${f.accepted.until ? `, until ${esc(f.accepted.until)}` : ""}</dd>` : ""}
        ${f.acceptanceExpired ? `<dt>Note</dt><dd>An acceptance for this finding expired on ${esc(f.acceptanceExpired.until)}.</dd>` : ""}
      </dl>
    </article>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Porchlight report${report.organization ? ` – ${esc(report.organization)}` : ""} – ${esc(report.when.slice(0, 10))}</title>
<style>
:root{--ink:#1b2a41;--ink2:#4a5568;--line:#dde2ea;--paper:#f6f7f9;--crit:#9b1c1c;--high:#b45309;--med:#8a6d00;--low:#3b5b7a;--pass:#2f7a4b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 48px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.2rem;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.meta{color:var(--ink2);margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.box{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px}.box b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums}.box span{color:var(--ink2);font-size:.85rem}
.scope{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 16px}.scope dt{font-weight:600;font-size:.8rem;color:var(--ink2)}.scope dd{margin:0 0 8px}
.f{background:#fff;border:1px solid var(--line);border-left:5px solid var(--low);border-radius:8px;padding:14px 18px;margin:0 0 12px;break-inside:avoid}
.f header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.f h3{margin:0;font-size:1.02rem;flex:1 1 300px}.f code{color:var(--ink2);font-size:.8rem}
.sev{font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--paper)}
.s-critical{border-left-color:var(--crit)}.s-critical .sev{color:var(--crit)}.s-high{border-left-color:var(--high)}.s-high .sev{color:var(--high)}
.s-medium{border-left-color:var(--med)}.s-medium .sev{color:var(--med)}.s-low .sev,.s-info .sev{color:var(--low)}
.dev{color:var(--ink2);margin:2px 0 8px;font-size:.9rem}dl{margin:0}dt{font-size:.75rem;font-weight:700;color:var(--ink2);margin-top:8px}dd{margin:0}ol{margin:2px 0;padding-left:20px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:.85rem;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;background:#fff;font-size:.9rem}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
ul.pass{padding-left:20px}footer{margin-top:40px;color:var(--ink2);font-size:.85rem}
@media print{body{background:#fff}main{padding:0}.f,.box,.scope{border-color:#ccc}}
</style></head><body><main>
<h1>Porchlight security checkup${report.organization ? `: ${esc(report.organization)}` : ""}</h1>
<p class="meta">${esc(when(report.when))} · ${report.devices.length} devices · ${esc(report.profile)} profile · Porchlight ${VERSION}</p>
<div class="grid">
  <div class="box"><b>${report.score.value}/100</b><span>${esc(report.score.label)}</span></div>
  <div class="box"><b>${c.critical + c.high}</b><span>critical or high</span></div>
  <div class="box"><b>${c.medium}</b><span>medium</span></div>
  <div class="box"><b>${c.low}</b><span>low</span></div>
  <div class="box"><b>${accepted.length}</b><span>accepted risks</span></div>
</div>
<h2>Scope</h2>
<dl class="scope">
  <dt>Networks checked</dt><dd>${esc(report.scope.join(", "))}</dd>
  ${report.authorization ? `<dt>Authorised by</dt><dd>${esc(report.authorization.by)}</dd>` : `<dt>Authorisation</dt><dd>Confirmed by the person running the checkup as their own network.</dd>`}
  <dt>Method</dt><dd>Read-only. Porchlight connects to common ports, reads what services announce (greetings, web page titles, protocol negotiation), and reads the Wi-Fi networks this computer can hear. It never logs in, never tries passwords, and sends nothing outside the checked network.</dd>
  ${report.changes && !report.changes.firstRun ? `<dt>Since the last checkup</dt><dd>${report.changes.newDevices.length} new device(s), ${report.changes.fixed.length} finding(s) fixed.</dd>` : ""}
</dl>
<h2>Open findings (${open.length})</h2>
${open.length ? open.map(card).join("") : "<p>None. Nothing needs fixing.</p>"}
${accepted.length ? `<h2>Accepted risks (${accepted.length})</h2>${accepted.map(card).join("")}` : ""}
<h2>Checks that passed (${passed.length})</h2>
<ul class="pass">${passed.map((f) => `<li>${esc(f.title)} <code>${esc(f.id)}</code></li>`).join("")}</ul>
<h2>Devices (${report.devices.length})</h2>
<table><thead><tr><th>Device</th><th>Address</th><th>Type</th><th>Open services</th></tr></thead><tbody>
${report.devices.map((d) => `<tr><td>${esc(d.name)}${d.isNew ? " <b>(new)</b>" : ""}</td><td>${esc(d.ip)}${d.mac ? `<br><span class="mono">${esc(d.mac)}</span>` : ""}</td><td>${esc(d.kind)}${d.vendor ? `<br>${esc(d.vendor)}` : ""}</td><td>${(d.doors || []).map((x) => `${esc(x.name)} ${x.port}`).join(", ") || "none"}</td></tr>`).join("")}
</tbody></table>
<footer>Generated by Porchlight ${VERSION}, an open-source, read-only network checkup. CIS Controls references are Porchlight's own mapping, not a certification by the Center for Internet Security. Levels: ${Object.values(LEVEL_LABEL).join(", ")}.</footer>
</main></body></html>
`;
}

export function render(report, format) {
  if (format === "html") return toHtml(report);
  if (format === "csv") return toCsv(report);
  if (format === "md") return toMarkdown(report);
  return JSON.stringify(report, null, 2);
}
