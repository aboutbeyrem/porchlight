// Porchlight panel. All text is inserted with textContent, never as HTML.
const $ = (id) => document.getElementById(id);
const LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know", "all-good": "All good" };
const ORDER = Object.keys(LABEL);

function show(id) {
  for (const s of ["consent", "running", "results", "error"]) $(s).hidden = s !== id;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (n.className = v) : n.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

async function loadContext() {
  show("consent");
  const ctx = await fetch("/api/context").then((r) => r.json()).catch(() => null);
  $("c-net").textContent = ctx?.network ? `${ctx.network.cidr} (this computer: ${ctx.network.address})` : "Not connected";
  $("c-router").textContent = ctx?.network?.gateway || "Unknown";
  const sel = $("c-ssid");
  sel.replaceChildren();
  const names = ctx?.connectedSsid ? [ctx.connectedSsid, ...ctx.visibleSsids.filter((s) => s !== ctx.connectedSsid)] : ctx?.visibleSsids || [];
  sel.append(el("option", { value: "" }, names.length ? "I'm not sure / skip the Wi-Fi check" : "No Wi-Fi adapter: skip the Wi-Fi check"));
  for (const n of names) sel.append(el("option", { value: n }, n + (n === ctx.connectedSsid ? " (connected)" : "")));
  if (ctx?.connectedSsid) sel.value = ctx.connectedSsid;
  $("c-start").disabled = !$("c-ok").checked || !ctx?.network;
}

async function start() {
  const homeSsid = $("c-ssid").value || null;
  const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, homeSsid }) });
  if (!r.ok && r.status !== 409) return fail((await r.json()).error);
  show("running");
  poll();
}

async function poll() {
  const s = await fetch("/api/status").then((r) => r.json()).catch(() => null);
  if (!s) return setTimeout(poll, 1500);
  if (s.status === "running") { $("r-step").textContent = s.progress + "…"; return setTimeout(poll, 1000); }
  if (s.status === "error") return fail(s.error);
  if (s.status === "done") render(s.report);
}

function fail(msg) {
  $("e-msg").textContent = msg || "Something went wrong.";
  show("error");
}

function render(rep) {
  $("demo-note").hidden = !rep.demo;
  $("s-sentence").textContent = rep.summary;
  const when = new Date(rep.when).toLocaleString();
  $("s-meta").textContent = `Checked ${rep.devices.length} devices on ${rep.network.cidr} on ${when}, in ${rep.durationSec} seconds.${rep.homeSsid ? ` Your Wi-Fi: "${rep.homeSsid}".` : ""}`;
  const counts = $("s-counts");
  counts.replaceChildren();
  for (const l of ORDER) {
    const n = rep.findings.filter((f) => f.level === l).length;
    if (n) counts.append(el("span", { class: `pill lvl-${l}` }, `${n} ${LABEL[l].toLowerCase()}`));
  }
  const list = $("list");
  list.replaceChildren();
  for (const f of rep.findings) {
    const fix = f.fix.length ? el("div", {}, el("dt", {}, `How to fix it${f.minutes ? ` (about ${f.minutes} min)` : ""}`), el("dd", {}, el("ol", {}, ...f.fix.map((s) => el("li", {}, s))))) : null;
    list.append(el("article", { class: `panel finding f-${f.level}` },
      el("span", { class: `pill lvl-${f.level}` }, LABEL[f.level]),
      el("h2", {}, f.title),
      f.deviceName ? el("p", { class: "dev" }, f.deviceName) : null,
      el("dl", {},
        el("div", {}, el("dt", {}, "What we found"), el("dd", {}, f.found)),
        el("div", {}, el("dt", {}, "What that means"), el("dd", {}, f.means)),
        el("div", {}, el("dt", {}, "How likely it matters"), el("dd", {}, f.likely)),
        fix)));
  }
  $("d-count").textContent = rep.devices.length;
  const doors = (d) => (d.doors || []).length
    ? el("ul", { class: "doors" }, ...d.doors.map((x) => el("li", {}, x.plain, el("span", { class: "hint inline" }, ` ${x.name}, port ${x.port}`))))
    : el("span", { class: "hint" }, "none answered");
  $("d-body").replaceChildren(...rep.devices.map((d) =>
    el("tr", {}, el("td", {}, d.name.replace(` (${d.ip})`, ""), el("span", { class: "hint" }, d.kind)), el("td", {}, d.ip), el("td", {}, doors(d)))));
  show("results");
}

$("c-ok").addEventListener("change", () => ($("c-start").disabled = !$("c-ok").checked));
$("c-start").addEventListener("click", start);
$("again").addEventListener("click", () => (new URLSearchParams(location.search).has("demo") ? (location.href = "/") : loadContext()));
$("e-retry").addEventListener("click", loadContext);
$("pdf").addEventListener("click", () => window.print());

if (new URLSearchParams(location.search).has("demo")) {
  fetch("demo.json").then((r) => r.json()).then(render).catch(loadContext);
} else {
  fetch("/api/status").then((r) => r.json()).then((s) => (s.status === "running" ? (show("running"), poll()) : s.status === "done" ? render(s.report) : loadContext())).catch(loadContext);
}
