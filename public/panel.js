// Porchlight panel. All text is inserted with textContent, never as HTML.
const $ = (id) => document.getElementById(id);
const LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know", "all-good": "All good" };
const ORDER = Object.keys(LABEL);
const isDemo = new URLSearchParams(location.search).has("demo");
let report = null;
const filter = { level: null, device: null };

function show(id) {
  for (const s of ["consent", "running", "results", "error"]) $(s).hidden = s !== id;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "vars") for (const [name, val] of Object.entries(v)) n.style.setProperty(name, val); // CSSOM: allowed by the panel's CSP
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
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
  const p = ctx?.policy;
  $("c-policy").hidden = !p;
  if (p) {
    $("c-policy").textContent = `Using the policy${p.organization ? ` for ${p.organization}` : ""}: ${p.knownDevices} known devices, ${p.accepted} accepted risks${p.ranges?.length ? `, ranges ${p.ranges.join(", ")} authorised by ${p.authorizedBy}` : ""}.`;
    const radio = document.querySelector(`input[name=profile][value="${p.profile}"]`);
    if (radio) radio.checked = true;
  }
  $("c-start").disabled = !$("c-ok").checked || !ctx?.network;
}

async function start() {
  const homeSsid = $("c-ssid").value || null;
  const profile = document.querySelector("input[name=profile]:checked")?.value || "home";
  const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, homeSsid, profile }) });
  if (!r.ok && r.status !== 409) return fail((await r.json()).error);
  document.querySelectorAll("#r-steps li").forEach((li) => li.classList.remove("done", "now"));
  show("running");
  poll();
}

async function poll() {
  const s = await fetch("/api/status").then((r) => r.json()).catch(() => null);
  if (!s) return setTimeout(poll, 1500);
  if (s.status === "running") { $("r-step").textContent = s.progress + "…"; markStep(s.progress); return setTimeout(poll, 1000); }
  if (s.status === "error") return fail(s.error);
  if (s.status === "done") render(s.report);
}

// The running screen ticks off each step as the checkup reaches the next one.
const STEP_OF = [[/finding your network/i, "network"], [/looking for devices/i, "devices"], [/describe themselves/i, "describe"], [/open doors/i, "doors"], [/router|wi-fi/i, "wifi"]];
function markStep(progress) {
  const current = STEP_OF.find(([re]) => re.test(progress || ""))?.[1];
  if (!current) return;
  let passed = true;
  for (const li of document.querySelectorAll("#r-steps li")) {
    const isCurrent = li.dataset.step === current;
    if (isCurrent) passed = false;
    li.classList.toggle("done", passed);
    li.classList.toggle("now", isCurrent);
  }
}

function fail(msg) {
  $("e-msg").textContent = msg || "Something went wrong.";
  show("error");
}

// ---------- results ----------
const worstLevel = (fs) => ORDER.find((l) => fs.some((f) => f.level === l && !f.accepted)) || (fs.length ? "all-good" : null);
const shortName = (d) => d.name.replace(` (${d.ip})`, "").replace(/ at \d+\.\d+\.\d+\.\d+$/, "");
const findingsFor = (ip) => report.findings.filter((f) => f.device === ip);
const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

function renderScore(score) {
  const value = score?.value ?? 100;
  const c = 2 * Math.PI * 52;
  // The ring fills from empty when results arrive (a once-per-checkup moment).
  const arc = $("score-arc");
  arc.style.transition = "none";
  arc.style.strokeDasharray = `0 ${c}`;
  void arc.getBoundingClientRect(); // commit the empty ring, then let it fill
  arc.style.transition = "";
  arc.style.strokeDasharray = `${(value / 100) * c} ${c}`;
  $("score").className = `score ${value >= 90 ? "s-good" : value >= 70 ? "s-ok" : "s-low"}`;
  $("score").setAttribute("aria-label", `Score ${value} out of 100`);
  $("score-value").textContent = value;
  $("score-label").textContent = score?.label || "";
}

function renderChanges(rep) {
  const box = $("s-changes");
  const ch = rep.changes;
  box.hidden = !ch;
  if (!ch) return;
  if (ch.firstRun) {
    box.textContent = `First checkup on this network. Porchlight will remember these ${rep.devices.length} devices (on this computer only) and tell you next time if a new one joins or something gets fixed.`;
    return;
  }
  const since = ch.since ? new Date(ch.since).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "last time";
  const parts = [];
  if (ch.newDevices.length) parts.push(`${ch.newDevices.length} new device${ch.newDevices.length > 1 ? "s" : ""}`);
  if (ch.fixed.length) parts.push(`${ch.fixed.length} thing${ch.fixed.length > 1 ? "s" : ""} fixed`);
  box.textContent = `Since your last checkup (${since}): ${parts.length ? parts.join(", ") : "no new devices, nothing changed"}.`;
}

function renderCounts() {
  const counts = $("s-counts");
  counts.replaceChildren();
  const levels = [...ORDER, "accepted"];
  for (const l of levels) {
    const n = report.findings.filter((f) => (l === "accepted" ? f.accepted : f.level === l && !f.accepted)).length;
    if (!n) continue;
    counts.append(el("button", {
      class: `pill ${l === "accepted" ? "accepted" : `lvl-${l}`}${filter.level === l ? " on" : ""}`,
      "aria-pressed": String(filter.level === l),
      title: filter.level === l ? "Show everything" : `Show "${LABEL[l] || "Accepted"}" only`,
      onclick: () => { filter.level = filter.level === l ? null : l; filter.device = null; renderList(); },
    }, `${n} ${(LABEL[l] || "accepted").toLowerCase()}`));
  }
}

function deviceNode(d, extra = []) {
  const fs = findingsFor(d.ip);
  const lvl = worstLevel(fs);
  const issues = fs.filter((f) => !f.accepted && (f.level === "fix-soon" || f.level === "worth-fixing")).length;
  return el("button", {
    class: `node${filter.device === d.ip ? " on" : ""}`,
    "aria-pressed": String(filter.device === d.ip),
    onclick: () => {
      filter.device = filter.device === d.ip ? null : d.ip;
      filter.level = null;
      renderList();
      if (filter.device) $("filter-note").scrollIntoView({ behavior: smooth(), block: "start" });
    },
  },
    el("span", { class: `dot dot-${lvl || "none"}`, "aria-hidden": "true" }),
    el("span", { class: "node-text" },
      el("span", { class: "node-name" }, shortName(d), d.isNew ? el("span", { class: "badge" }, "New") : null),
      el("span", { class: "node-kind" }, d.self ? d.kind : shortName(d).toLowerCase().startsWith(d.kind.toLowerCase()) ? d.ip : `${d.kind} · ${d.ip}`),
      issues ? el("span", { class: "node-issues" }, `${issues} to fix`) : null,
      extra));
}

function renderMap() {
  const router = report.devices.find((d) => d.isRouter);
  $("map-router").replaceChildren(router ? deviceNode(router) : el("p", { class: "hint" }, "Router not found"));
  const wifi = report.wifi?.yours || [];
  $("map-wifi").hidden = !wifi.length;
  $("map-wifi").replaceChildren(...wifi.map((w) => el("li", { class: "wifi-chip" },
    el("span", { class: "wifi-icon", "aria-hidden": "true" }),
    w.ssid,
    el("span", { class: "chip-note" }, `${w.auth ? w.auth.replace(/-Personal/g, "") : "protection unknown"}${w.wps ? " · WPS on" : ""}`))));
  const rank = (d) => { const l = worstLevel(findingsFor(d.ip)); return l ? ORDER.indexOf(l) : ORDER.length; };
  const others = report.devices.filter((d) => !d.isRouter).sort((a, b) => b.self - a.self || rank(a) - rank(b));
  $("map-devices").replaceChildren(...others.map((d, i) =>
    el("li", { vars: { "--n": Math.min(i, 8) } }, deviceNode(d, d.broadcasts?.length ? el("span", { class: "node-kind" }, `Broadcasts "${d.broadcasts.join('", "')}"`) : null))));
}

function techDetails(f) {
  const refs = [...(f.cis || []).map((c) => `CIS Controls v8 ${c}`), ...(f.refs || [])];
  if (!f.technical && !refs.length && !f.id) return null;
  return el("details", { class: "tech" },
    el("summary", {}, "Details for IT"),
    el("dl", {},
      el("div", {}, el("dt", {}, "Check"), el("dd", { class: "mono" }, `${f.id || "?"} · severity ${f.severity || "?"}`)),
      f.technical ? el("div", {}, el("dt", {}, "Observed"), el("dd", { class: "mono" }, f.technical)) : null,
      refs.length ? el("div", {}, el("dt", {}, "References"), el("dd", {}, refs.join(", "))) : null));
}

function findingCard(f) {
  const fix = f.fix.length ? el("div", {}, el("dt", {}, `How to fix it${f.minutes ? ` (about ${f.minutes} min)` : ""}`), el("dd", {}, el("ol", {}, f.fix.map((s) => el("li", {}, s))))) : null;
  return el("article", { class: `panel finding f-${f.level}${f.accepted ? " is-accepted" : ""}` },
    el("div", { class: "meta-row" },
      el("span", { class: `pill lvl-${f.level}` }, LABEL[f.level]),
      f.accepted ? el("span", { class: "pill accepted" }, `Accepted${f.accepted.until ? ` until ${f.accepted.until}` : ""}`) : null,
      f.id ? el("span", { class: "fid" }, f.id) : null),
    el("h2", {}, f.title),
    f.deviceName ? el("p", { class: "dev" }, f.deviceName) : null,
    el("dl", {},
      el("div", {}, el("dt", {}, "What we found"), el("dd", {}, f.found)),
      el("div", {}, el("dt", {}, "What that means"), el("dd", {}, f.means)),
      el("div", {}, el("dt", {}, "How likely it matters"), el("dd", {}, f.likely)),
      f.accepted ? el("div", {}, el("dt", {}, "Why it's accepted"), el("dd", {}, `${f.accepted.reason}${f.accepted.by ? ` (${f.accepted.by})` : ""}`)) : null,
      fix),
    techDetails(f));
}

function renderList() {
  const levelMatch = (f) => !filter.level || (filter.level === "accepted" ? f.accepted : f.level === filter.level && !f.accepted);
  const shown = report.findings.filter((f) => levelMatch(f) && (!filter.device || f.device === filter.device));
  $("filter-note").hidden = !filter.level && !filter.device;
  if (filter.device) {
    const d = report.devices.find((x) => x.ip === filter.device);
    $("filter-text").textContent = shown.length ? `Showing what Porchlight found on ${shortName(d)}.` : `Porchlight found nothing to report on ${shortName(d)}.`;
  } else if (filter.level) {
    $("filter-text").textContent = `Showing "${LABEL[filter.level] || "Accepted"}" only.`;
  }
  $("list").replaceChildren(...shown.map((f, i) => {
    const card = findingCard(f);
    card.style.setProperty("--n", Math.min(i, 6));
    return card;
  }));
  renderCounts();
  renderMap();
}

function render(rep) {
  report = rep;
  filter.level = filter.device = null;
  $("demo-note").hidden = !rep.demo;
  $("dl-html").hidden = $("dl-csv").hidden = Boolean(rep.demo);
  renderScore(rep.score);
  $("s-sentence").textContent = rep.summary;
  const when = new Date(rep.when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  $("s-meta").textContent = `Checked ${rep.devices.length} devices on ${(rep.scope || [rep.network.cidr]).join(", ")} on ${when}, in ${rep.durationSec} seconds${rep.profile === "office" ? " (office checks)" : ""}.${rep.homeSsid ? ` Wi-Fi: "${rep.homeSsid}".` : ""}${rep.authorization ? ` Authorised by ${rep.authorization.by}.` : ""}`;
  renderChanges(rep);
  renderList();
  // Results appear once per checkup: let them arrive in order. Filtering afterwards is instant.
  const res = $("results");
  res.classList.remove("arrive");
  void res.offsetWidth;
  res.classList.add("arrive");
  clearTimeout(render.settle);
  render.settle = setTimeout(() => res.classList.remove("arrive"), 1400); // after this, filtering is instant
  $("d-count").textContent = rep.devices.length;
  const doors = (d) => (d.doors || []).length
    ? el("ul", { class: "doors" }, d.doors.map((x) => el("li", {}, x.plain, el("span", { class: "hint inline" }, ` ${x.name}, port ${x.port}`))))
    : el("span", { class: "hint" }, "none answered");
  $("d-body").replaceChildren(...rep.devices.map((d) =>
    el("tr", {}, el("td", {}, shortName(d), el("span", { class: "hint" }, d.kind + (d.vendor ? ` · ${d.vendor}` : ""))), el("td", {}, d.ip), el("td", {}, doors(d)))));
  show("results");
}

$("c-ok").addEventListener("change", () => ($("c-start").disabled = !$("c-ok").checked));
$("c-start").addEventListener("click", start);
$("again").addEventListener("click", () => (isDemo ? (location.href = "/") : loadContext()));
$("e-retry").addEventListener("click", loadContext);
$("pdf").addEventListener("click", () => window.print());
$("filter-clear").addEventListener("click", () => { filter.level = filter.device = null; renderList(); });

if (isDemo) {
  fetch("demo.json").then((r) => r.json()).then(render).catch(loadContext);
} else {
  fetch("/api/status").then((r) => r.json()).then((s) => (s.status === "running" ? (show("running"), poll()) : s.status === "done" ? render(s.report) : loadContext())).catch(loadContext);
}
