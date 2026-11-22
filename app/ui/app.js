// Porchlight for Windows: the window. Text goes in with textContent and SVG is built with the DOM, so nothing from
// the network is ever parsed as HTML. The Rust side does all the watching; this side answers one question first,
// "is my home OK, and what do I do now?", then everything else.
const T = window.__TAURI__;
const invoke = (cmd, args) => T.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know" };
const WIFI_IDS = ["PL-WIFI-WEAK", "PL-WPS", "PL-NO-PMF", "PL-EVIL-TWIN", "PL-SSID-DUPLICATE", "PL-SAVED-OPEN", "PL-SAVED-HIDDEN"];
// Roughly how long each fix takes, so the quickest wins come first.
const EFFORT = { "PL-WPS": 5, "PL-RDP-NLA": 5, "PL-ADB": 5, "PL-DOCKER": 5, "PL-SAVED-OPEN": 5, "PL-SAVED-HIDDEN": 5, "PL-EVIL-TWIN": 2, "PL-SSID-DUPLICATE": 5,
  "PL-NO-PMF": 10, "PL-FTP": 10, "PL-SMB1": 10, "PL-RTSP-OPEN": 10, "PL-VNC": 10, "PL-DEFAULT-PASSWORD": 10, "PL-UPNP-MAPPING": 10, "PL-DNS-INVENTS": 10, "PL-DNS-LOCAL": 10,
  "PL-IPV6-PUBLIC": 10, "PL-IPV6-ROUTERS": 15, "PL-TELNET": 15, "PL-MQTT": 15, "PL-WIFI-WEAK": 15, "PL-XMEYE": 20 };
const PORTS = { 21: "FTP file sharing", 22: "SSH", 23: "Telnet", 80: "Settings page", 443: "Settings page (secure)", 445: "Windows file sharing", 554: "Video stream", 1883: "Smart-home messages", 2323: "Telnet", 2375: "Docker", 3389: "Remote Desktop", 5555: "Android debugging", 5900: "Screen sharing (VNC)", 8000: "Web page", 8080: "Web page", 8554: "Video stream", 34567: "XMEye", 37777: "Dahua" };
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n, one, many = `${one}s`) => `${n <= 10 ? WORDS[n] : n} ${n === 1 ? one : many}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let S = null;
let devFilter = "online";
let editing = null; // device being renamed on Who's here
let naming = null; // device being named at the door
let mapDrawnFor = "";
let pending = null; // { key, title, since, result } while "I did it, check again" runs
const openRows = new Set();
const drawn = {};

// ---------- small stores that only matter on this computer ----------
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};

// ---------- icons: one family, 24px grid, 1.75 stroke ----------
const ICONS = {
  home: { p: ["M4 11.5L12 4.5l8 7", "M6.5 9.8v9.7h11V9.8", "M10.2 19.5v-5h3.6v5"] },
  shield: { p: ["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9C7.7 19.8 4.5 16.1 4.5 11.5V6z", "M9 12l2.2 2.2L15.5 10"] },
  devices: { r: [[2.5, 5, 13, 9.5, 1.5], [17.5, 8, 4.5, 11.5, 1.2]], p: ["M6 18.5h6", "M9 14.5v4"] },
  wifi: { p: ["M2.5 9a14 14 0 0 1 19 0", "M5.8 12.6a9.4 9.4 0 0 1 12.4 0", "M9.1 16.1a4.6 4.6 0 0 1 5.8 0", "M12 19.6h.01"] },
  bell: { p: ["M6 16.5v-5a6 6 0 0 1 12 0v5l1.6 2H4.4z", "M10 20.5a2 2 0 0 0 4 0"] },
  sliders: { p: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9"], c: [[15, 7, 2], [9, 17, 2]] },
  refresh: { p: ["M20 12a8 8 0 1 1-2.6-5.9", "M20 4.5V9h-4.5"] },
  eye: { p: ["M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"], c: [[12, 12, 2.8]] },
  lock: { r: [[5, 10.5, 14, 10, 2]], p: ["M8 10.5V8a4 4 0 0 1 8 0v2.5"] },
  chat: { p: ["M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z", "M8 9.5h8", "M8 12.5h5"] },
  alert: { p: ["M12 4l9 15.5H3z", "M12 10v4", "M12 17h.01"] },
  check: { c: [[12, 12, 9]], p: ["M8.5 12.3l2.3 2.3 4.7-4.8"] },
  chevron: { p: ["M7 10l5 5 5-5"] },
  router: { r: [[3, 13.5, 18, 6, 1.6]], p: ["M7 13.5L5.5 7", "M17 13.5L18.5 7", "M7 16.5h.01", "M10 16.5h.01", "M14 16.5h3"] },
  phone: { r: [[7, 2.5, 10, 19, 2.2]], p: ["M11 18.5h2"] },
  laptop: { r: [[5, 5, 14, 10, 1.4]], p: ["M2.5 19h19", "M5 15l-2 4", "M19 15l2 4"] },
  monitor: { r: [[3, 4, 18, 12.5, 1.5]], p: ["M8.5 20h7", "M12 16.5V20"] },
  camera: { r: [[2.5, 7.5, 13, 10, 2]], c: [[9, 12.5, 2.6]], p: ["M15.5 11l6-3v9l-6-3"] },
  tv: { r: [[2.5, 4.5, 19, 12.5, 1.6]], p: ["M8 20.5h8", "M12 17v3.5"] },
  extender: { r: [[7.5, 11, 9, 9.5, 1.6]], p: ["M5.2 7.6a9.3 9.3 0 0 1 13.6 0", "M8.2 10a5 5 0 0 1 7.6 0", "M10.5 20.5v1.5", "M13.5 20.5v1.5", "M12 15h.01"] },
  printer: { r: [[6.5, 3, 11, 5, 0.8], [3.5, 8, 17, 8, 1.6], [7, 13.5, 10, 7, 0.8]] },
  plug: { p: ["M9 3v5", "M15 3v5", "M12 14v3.5", "M10 21h4"], r: [[6, 8, 12, 6, 2.2]] },
  chip: { r: [[6.5, 6.5, 11, 11, 2]], p: ["M9.5 3v3.5", "M14.5 3v3.5", "M9.5 17.5V21", "M14.5 17.5V21", "M3 9.5h3.5", "M3 14.5h3.5", "M17.5 9.5H21", "M17.5 14.5H21"] },
};

function icon(name) {
  const def = ICONS[name] || ICONS.chip;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  for (const d of def.p || []) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.append(p); }
  for (const [x, y, w, h, rx] of def.r || []) { const r = document.createElementNS(NS, "rect"); Object.entries({ x, y, width: w, height: h, rx }).forEach(([k, v]) => r.setAttribute(k, v)); svg.append(r); }
  for (const [cx, cy, rr] of def.c || []) { const c = document.createElementNS(NS, "circle"); Object.entries({ cx, cy, r: rr }).forEach(([k, v]) => c.setAttribute(k, v)); svg.append(c); }
  return svg;
}
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
const ic = (name, extra = "") => { const s = el("span", { class: `ic ${extra}` }); s.append(icon(name)); return s; };
for (const n of document.querySelectorAll("[data-icon]")) n.append(icon(n.dataset.icon));
// Fills a node, skipping the pieces that are absent (so nothing ever prints "null").
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const dot = (level) => el("span", { class: `lvl ${level}`, "aria-hidden": "true" });

const KIND_ICON = (kind = "") => {
  const k = kind.toLowerCase();
  if (k === "router") return "router";
  if (k === "this computer") return "laptop";
  if (k.includes("camera")) return "camera";
  if (k.includes("extender") && !k.includes("on your")) return "extender";
  if (k.includes("tv") || k.includes("streaming")) return "tv";
  if (k.includes("printer")) return "printer";
  if (k.includes("smart-home")) return "plug";
  if (k.includes("phone") || k.includes("apple")) return "phone";
  if (k.includes("computer") || k.includes("laptop")) return "monitor";
  return "chip";
};

const ago = (t) => {
  if (!t) return "never";
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
};
const partOfDay = (h = new Date().getHours()) => (h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night");

// ---------- what needs doing ----------
const fkey = (f) => `${f.id}|${f.device || ""}`;
const accepted = () => new Set(S.accepted || []);
const isOpen = (f) => (f.level === "fix-soon" || f.level === "worth-fixing") && !accepted().has(fkey(f));
function openFindings() {
  const skipped = store.get("pl-skip", []);
  const rank = (f) => (f.level === "fix-soon" ? 0 : 1) * 1000 + (skipped.includes(fkey(f)) ? 500 : 0) + (EFFORT[f.id] || 10);
  return S.findings.filter(isOpen).sort((a, b) => rank(a) - rank(b));
}
const effortOf = (f) => EFFORT[f.id] || 10;
function whereOf(f) {
  const d = f.device && S.devices[f.device];
  if (d) return d.isRouter ? "On your router" : `On ${d.name}`;
  if (f.id.startsWith("PL-SAVED")) return "On this computer";
  if (f.id.startsWith("PL-DNS") || f.id.startsWith("PL-IPV6")) return "In your network settings";
  if (WIFI_IDS.includes(f.id)) return "Your Wi-Fi";
  if (f.id === "PL-UPNP-MAPPING") return "On your router";
  return "Your network";
}
const worstFor = (key) => {
  const fs = (S?.findings || []).filter((f) => f.device === key && isOpen(f)).map((f) => f.level);
  return ["fix-soon", "worth-fixing"].find((l) => fs.includes(l)) || "";
};
const announced = (d) => d.customName || d.upnpName || d.serviceName || d.detectedName || d.webTitle || d.routerName;
const isNew = (d) => S.baselineAt && !d.isSelf && d.firstSeen > S.baselineAt && Date.now() / 1000 - d.firstSeen < 7 * 86400;
const atTheDoor = () => Object.values(S.devices).filter((d) => d.online && !d.isSelf && !d.isRouter && !d.kind.startsWith("this computer") && ((d.owner == null && isNew(d)) || d.owner === false || naming === d.key));

// ---------- toast ----------
let toastTimer = 0;
function toast(text, undo) {
  const t = $("toast");
  put(t, el("span", {}, text), undo ? el("button", { class: "link", onclick: () => { undo(); t.classList.remove("on"); } }, "Undo") : null);
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), undo ? 8000 : 5000);
}

// ---------- title bar ----------
const win = T.window?.getCurrentWindow?.();
$("win-min").addEventListener("click", () => win?.minimize());
$("win-max").addEventListener("click", () => win?.toggleMaximize());
$("win-close").addEventListener("click", () => win?.close());

// ---------- welcome ----------
async function showWelcome() {
  $("welcome").hidden = false;
  $("app").hidden = true;
  const info = await invoke("visible_networks").catch(() => ({ visible: [] }));
  $("w-net").textContent = info.network ? info.network.cidr : "Not connected";
  $("w-router").textContent = info.network ? info.network.gateway : "–";
  const names = info.connected ? [info.connected, ...info.visible.filter((v) => v !== info.connected)] : info.visible;
  put($("w-ssid"), el("option", { value: "" }, names.length ? "Choose your Wi-Fi…" : "No Wi-Fi adapter (skip)"), ...names.map((n) => el("option", { value: n }, n + (n === info.connected ? "  (connected)" : ""))));
  if (info.connected) $("w-ssid").value = info.connected;
  const ready = () => ($("w-start").disabled = !$("w-ok").checked || !info.network);
  $("w-ok").onchange = ready;
  ready();
}
$("w-start").addEventListener("click", async () => {
  $("w-start").disabled = true;
  await invoke("start_watching", { homeSsid: $("w-ssid").value || null });
});

// ---------- the map ----------
// The router in the middle; devices on rings around it, the ones that need attention closest; devices behind an
// extender fanned out beside it. Rings hold 10, 16, 22 and 28 devices, so about 75 stay readable; past that, a
// "+N" node opens Who's here. One Tab stop: the arrow keys move between devices.
const RINGS = [10, 16, 22, 28];

function mapLayout(all) {
  const extender = all.find((d) => d.kind === "Wi-Fi extender");
  const behindExt = (d) => d.behindRepeater && extender;
  const rank = (d) => ({ "fix-soon": 0, "worth-fixing": 1 })[worstFor(d.key)] ?? 2;
  const order = (a, b) => rank(a) - rank(b) || (b === extender) - (a === extender) || a.name.localeCompare(b.name);
  const direct = all.filter((d) => !behindExt(d)).sort(order);
  const behind = all.filter(behindExt).sort(order);
  const capacity = RINGS.reduce((a, b) => a + b, 0);
  const shown = direct.slice(0, direct.length > capacity ? capacity - 1 : capacity);
  const more = direct.length - shown.length;
  const items = more ? [...shown, { more }] : shown;
  let k = 1;
  while (RINGS.slice(0, k).reduce((a, b) => a + b, 0) < items.length) k++;
  const total = RINGS.slice(0, k).reduce((a, b) => a + b, 0);
  const pos = new Map();
  const nodes = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const n = i === k - 1 ? items.length - at : Math.round((items.length * RINGS[i]) / total);
    const ring = items.slice(at, at + n);
    at += n;
    const [rx, ry] = k === 1 ? [150, 102] : [112 + i * 62, 78 + i * 44];
    const r = k === 1 ? 19 : i === 0 ? 16 : 13;
    ring.forEach((d, j) => {
      const a = -Math.PI / 2 + (j / ring.length) * Math.PI * 2 + (ring.length % 2 ? 0 : Math.PI / ring.length) + i * 0.35;
      const p = [Math.cos(a) * rx, Math.sin(a) * ry];
      if (d.key) pos.set(d.key, p);
      nodes.push({ d, p, r, parent: [0, 0], sub: false, label: k === 1 && items.length <= 8 });
    });
  }
  if (extender && pos.has(extender.key)) {
    const [ex, ey] = pos.get(extender.key);
    const out = Math.atan2(ey, ex);
    const reach = 58 + Math.max(0, behind.length - 5) * 7;
    const step = Math.min(0.62, (Math.PI * 1.4) / Math.max(behind.length - 1, 1));
    behind.forEach((d, i) => {
      const a = out + (i - (behind.length - 1) / 2) * step;
      nodes.push({ d, p: [ex + Math.cos(a) * reach, ey + Math.sin(a) * reach * 0.8], r: behind.length > 8 ? 12 : 15, parent: [ex, ey], sub: true });
    });
  }
  return nodes;
}

function drawMap() {
  const all = Object.values(S.devices).filter((d) => d.online && !d.isRouter);
  const router = Object.values(S.devices).find((d) => d.isRouter);
  const sig = JSON.stringify([router?.key, all.map((d) => [d.key, d.name, d.kind, d.behindRepeater, worstFor(d.key)])]);
  if (sig === mapDrawnFor) return;
  const first = !mapDrawnFor;
  mapDrawnFor = sig;
  const svg = $("map");
  const nodes = mapLayout(all);
  const xs = nodes.map((n) => n.p[0]), ys = nodes.map((n) => n.p[1]);
  const half = [Math.max(200, ...xs.map(Math.abs).map((v) => v + 30)), Math.max(130, ...ys.map(Math.abs).map((v) => v + 30))];
  svg.setAttribute("viewBox", `${-half[0]} ${-half[1]} ${half[0] * 2} ${half[1] * 2}`);
  svg.setAttribute("aria-label", `Map of your home: ${count(all.length, "device")} around your router. Use the arrow keys to move between them.`);
  svg.replaceChildren();
  const defs = svgEl("defs");
  const grad = svgEl("radialGradient", { id: "halo" });
  grad.append(svgEl("stop", { offset: "0", "stop-color": "#f2b544", "stop-opacity": "0.32" }), svgEl("stop", { offset: "1", "stop-color": "#f2b544", "stop-opacity": "0" }));
  defs.append(grad);
  svg.append(defs, svgEl("circle", { class: "halo", cx: 0, cy: 0, r: 110 }));
  for (const n of nodes) svg.append(svgEl("line", { class: `link-line${n.sub ? " sub" : ""}`, x1: n.parent[0], y1: n.parent[1], x2: n.p[0], y2: n.p[1] }));
  const focusable = [];
  const node = (d, [x, y], r, i, isRouter = false, label = false) => {
    const lvl = d.key ? worstFor(d.key) : "";
    const name = d.more ? `${d.more} more devices` : d.name;
    const spoken = d.more ? `${name}: open Who's here` : `${name}, ${isRouter ? "your router" : d.kind}${lvl ? `, ${LABEL[lvl].toLowerCase()}` : ""}`;
    // The outer group holds the position; the inner one animates, so the entrance never moves a device.
    const g = svgEl("g", { class: `node${isRouter ? " router" : ""}${d.more ? " more" : ""}`, transform: `translate(${x} ${y})`, tabindex: "-1", role: "button", "aria-label": spoken });
    const body = svgEl("g", { class: `body${first ? " appear" : ""}` });
    body.style.setProperty("--i", Math.min(i, 12));
    g.append(body);
    body.append(svgEl("circle", { class: "bg", r }));
    if (lvl) body.append(svgEl("circle", { class: `ring ${lvl}`, r: r + 3.5 }));
    if (d.more) {
      const t = svgEl("text", { class: "more-n", y: 4 });
      t.textContent = `+${d.more}`;
      body.append(t);
    } else {
      const glyph = icon(KIND_ICON(isRouter ? "router" : d.kind));
      const s = r * 1.05;
      Object.entries({ x: -s / 2, y: -s / 2, width: s, height: s, class: "icon glyph" }).forEach(([k, v]) => glyph.setAttribute(k, v));
      body.append(glyph);
    }
    const tip = svgEl("title");
    tip.textContent = d.more ? name : d.name;
    g.append(tip);
    if (isRouter || label) {
      const text = isRouter ? "Router" : d.name;
      const t = svgEl("text", { y: r + 20 });
      t.textContent = text.length > 13 ? `${text.slice(0, 12)}…` : text;
      body.append(t);
    }
    const open = () => { if (d.more) go("devices"); else showDevice(d.key); };
    g.addEventListener("click", open);
    g.addEventListener("keydown", (e) => {
      const at = focusable.indexOf(g);
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: focusable.length - 1 }[e.key];
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      else if (to != null) {
        e.preventDefault();
        const next = focusable[(to + focusable.length) % focusable.length];
        g.setAttribute("tabindex", "-1");
        next.setAttribute("tabindex", "0");
        next.focus();
      }
    });
    focusable.push(g);
    svg.append(g);
  };
  if (router) node(router, [0, 0], 28, 0, true);
  nodes.forEach((n, i) => node(n.d, n.p, n.r, i + 1, false, n.label));
  focusable[0]?.setAttribute("tabindex", "0");
  const behind = all.filter((d) => d.behindRepeater).length;
  $("map-caption").textContent = `${all.length} device${all.length === 1 ? "" : "s"} here now${behind ? `, ${behind} through your extender` : ""}`;
  const levels = new Set(all.map((d) => worstFor(d.key)));
  $("lg-soon").hidden = !levels.has("fix-soon");
  $("lg-worth").hidden = !levels.has("worth-fixing");
  $("lg-sub").hidden = !behind;
  document.querySelector(".map-legend").hidden = !levels.has("fix-soon") && !levels.has("worth-fixing") && !behind;
}

// ---------- pieces ----------
// A <details> that stays open across re-renders.
function keepOpen(details, key) {
  details.dataset.key = key;
  if (openRows.has(key)) details.open = true;
  details.addEventListener("toggle", () => (details.open ? openRows.add(key) : openRows.delete(key)));
  return details;
}

async function recheck(f) {
  pending = { key: fkey(f), title: f.title, since: S.lastCheck || 0, result: "checking" };
  await invoke("check_now", { full: true });
  render(true);
}
async function accept(f, yes = true) {
  await invoke("accept_finding", { key: fkey(f), accept: yes });
  if (yes) toast("Okay. Porchlight won't bring this up again.", () => accept(f, false));
}
function skip(f) {
  const s = store.get("pl-skip", []).filter((k) => k !== fkey(f));
  store.set("pl-skip", [...s, fkey(f)]);
  render(true);
}
function prefer(f) {
  store.set("pl-skip", store.get("pl-skip", []).filter((k) => k !== fkey(f)));
  // Everything else steps back, so this one becomes the next step.
  store.set("pl-skip", openFindings().filter((x) => fkey(x) !== fkey(f)).map(fkey));
  go("home");
  render(true);
}

function recheckNote(f) {
  if (!pending || pending.key !== fkey(f)) return el("p", { class: "recheck", role: "status" });
  if (pending.result === "still") return el("p", { class: "recheck still", role: "status" }, "It's still there. Some devices only apply a change after a restart: restart it, wait a minute, then check again.");
  return el("p", { class: "recheck", role: "status" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking your home again. This takes about a minute.");
}

function fixBody(f, { isNext = false } = {}) {
  const busy = pending?.key === fkey(f) && pending.result === "checking";
  return [
    el("p", { class: "why" }, f.means),
    f.fix.length ? el("ol", { class: "steps" }, f.fix.map((s) => el("li", {}, s))) : null,
    el("details", { class: "seen" }, el("summary", {}, "What Porchlight saw"), el("p", {}, f.found), el("p", {}, `How likely it matters: ${f.likely}`)),
    el("div", { class: "actions" },
      el("button", { class: `btn ${isNext ? "lamp" : "quiet small"}`, disabled: busy || S.busy, onclick: () => recheck(f) }, isNext ? "I did it, check again" : "I did it, check again"),
      isNext && openFindings().length > 1 ? el("button", { class: "btn quiet", onclick: () => skip(f) }, "Show me another") : null,
      !isNext ? el("button", { class: "btn quiet small", onclick: () => prefer(f) }, "Do this one next") : null,
      el("button", { class: "link quiet", onclick: () => accept(f) }, "It's fine, stop telling me")),
    recheckNote(f),
  ];
}

function findingRow(f, mode = "todo") {
  const meta = mode === "ok" ? null : mode === "tip" ? "Good to know" : `${LABEL[f.level]} · ${effortOf(f)} min`;
  const body = mode === "ok"
    ? [el("p", { class: "why" }, f.found), el("div", { class: "actions" }, el("button", { class: "btn quiet small", onclick: () => accept(f, false) }, "Put it back on my list"))]
    : mode === "tip"
      ? [el("p", { class: "why" }, f.found), el("p", { class: "why" }, f.means), f.fix.length ? el("ol", { class: "steps" }, f.fix.map((s) => el("li", {}, s))) : null, el("div", { class: "actions" }, el("button", { class: "link quiet", onclick: () => accept(f) }, "Got it, hide this"))]
      : fixBody(f);
  const d = keepOpen(el("details", { class: "item" },
    el("summary", {}, dot(mode === "ok" ? "good-to-know" : f.level), el("span", { class: "t" }, el("b", {}, f.title), el("small", {}, whereOf(f))), el("span", { class: "meta" }, meta), ic("chevron", "chev")),
    el("div", { class: "item-body" }, body)), `f-${mode}-${fkey(f)}`);
  return el("li", {}, d);
}

function avatar(d) {
  const lvl = d.online ? worstFor(d.key) : "offline";
  return el("div", { class: `avatar${d.isRouter ? " router" : ""}` }, icon(KIND_ICON(d.kind)), el("span", { class: `state ${lvl}`, title: lvl ? LABEL[lvl] || "Offline" : "No problems found" }));
}

function renameForm(d, done) {
  return el("form", { class: "rename", onsubmit: async (e) => { e.preventDefault(); const name = e.target.elements.n.value; done(); await invoke("rename_device", { key: d.key, name }); toast(`Saved. Porchlight will call it "${name.trim() || d.name}".`); } },
    el("input", { name: "n", value: d.customName || (announced(d) ? d.name : ""), placeholder: "For example: Mum's phone", maxlength: "40", "aria-label": `Name for ${d.name}` }),
    el("button", { class: "btn lamp small", type: "submit" }, "Save"),
    el("button", { class: "link quiet", type: "button", onclick: () => { done(); render(true); } }, "Skip"));
}

function doorRow(d) {
  const kindText = d.kind.toLowerCase() === d.name.toLowerCase() ? null : d.kind;
  const sub = [d.owner === false ? "you didn't recognise it" : `joined ${ago(d.firstSeen)}`, kindText, d.vendor, d.behindRepeater ? "through your extender" : null].filter(Boolean).join(" · ");
  const right = naming === d.key
    ? renameForm(d, () => { naming = null; })
    : d.owner === false
      ? el("div", { class: "row" }, el("button", { class: "btn quiet small", onclick: () => invoke("confirm_device", { key: d.key, mine: true }) }, "Actually, it's ours"))
      : el("div", { class: "row" },
        el("button", { class: "btn lamp small", onclick: async () => { await invoke("confirm_device", { key: d.key, mine: true }); if (!announced(d)) { naming = d.key; render(true); setTimeout(() => document.querySelector(".door .rename input")?.focus(), 0); } else toast("Thanks. Porchlight will remember it."); } }, "Yes, it's ours"),
        el("button", { class: "btn quiet small", onclick: () => invoke("confirm_device", { key: d.key, mine: false }) }, "I don't know it"));
  return el("div", { class: `door-row${d.owner === false ? " unknown" : ""}` }, avatar(d),
    el("div", { class: "t" }, el("b", {}, d.name), el("small", {}, sub)),
    right,
    d.owner === false ? el("div", { class: "door-help" }, "Then someone may know your Wi-Fi password. It could also be a visitor's phone, or a gadget you forgot about, like a smart plug.",
      el("ol", {}, el("li", {}, "Open your router's settings page, go to Wi-Fi (or Wireless), and set a new password of 12 characters or more."), el("li", {}, "Reconnect your own devices with the new password."), el("li", {}, "Porchlight will tell you if this device comes back."))) : null);
}

// ---------- Home ----------
function renderHome(force) {
  const open = openFindings();
  const door = atTheDoor();
  const tips = S.findings.filter((f) => f.level === "good-to-know" && !accepted().has(fkey(f)));
  const oks = S.findings.filter((f) => accepted().has(fkey(f)));
  const online = Object.values(S.devices).filter((d) => d.online);
  const soon = open.filter((f) => f.level === "fix-soon").length;
  const strangers = door.filter((d) => d.owner === false).length;

  // The sentence first: what Porchlight would say if you asked "how's home?"
  let line, sub;
  if (!S.lastCheck) { line = "Taking a first look…"; sub = "This takes about a minute. You can close the window: Porchlight keeps going in the tray."; }
  else if (!S.onHome) { line = "You're away from home."; sub = "Porchlight watches your home network and picks up again when you're back. It still watches the Wi-Fi around you here."; }
  else if (strangers) { line = strangers === 1 ? "Someone you don't recognise is on your Wi-Fi." : `${cap(count(strangers, "device"))} you don't recognise are on your Wi-Fi.`; sub = "Changing your Wi-Fi password sends them away. The steps are below."; }
  else if (!open.length && !door.length) { line = "All quiet at home."; sub = `${cap(count(online.length, "device"))} here, and nothing needs you. Porchlight keeps watching from the tray.`; }
  else if (soon) { line = soon === 1 ? "One thing should be fixed soon." : `${cap(WORDS[soon] || String(soon))} things should be fixed soon.`; }
  else if (open.length) { line = "Your home is mostly safe."; }
  else { line = door.length === 1 ? "Someone new joined your network." : `${cap(count(door.length, "new device"))} joined your network.`; sub = "Tell Porchlight whether you know them."; }
  if (!sub && open.length) sub = `${cap(count(open.length, "thing"))} to do${door.length ? ", and someone new to check" : ""}. The next one takes about ${effortOf(open[0])} minutes.`;
  $("status-line").textContent = line;
  $("status-sub").textContent = sub;
  put($("when"), ...[S.busy ? el("span", { class: "spinner", "aria-hidden": "true" }) : null,
    S.busy ? `Checking now${S.progress ? `: ${S.progress.toLowerCase()}` : ""}…` : `${cap(new Date().toLocaleDateString("en-GB", { weekday: "long" }))} ${partOfDay()} · ${S.lastCheck ? `checked ${ago(S.lastCheck)}` : "first look"}`].filter(Boolean));
  $("check-now").disabled = S.busy;
  $("check-label").textContent = S.busy ? "Checking…" : "Check now";
  $("lamp-pool").classList.toggle("quiet", Boolean(S.lastCheck) && !open.length && !door.length);
  document.querySelector(".tonight h2").textContent = `Your home ${partOfDay() === "night" ? "tonight" : `this ${partOfDay()}`}`;

  const sig = JSON.stringify([S.findings, S.accepted, door.map((d) => [d.key, d.name, d.owner]), naming, pending, S.busy, store.get("pl-skip", []), S.lastCheck, S.onHome, S.listening, S.wifi.copies.length]);
  if (force !== true && sig === drawn.home) { drawMap(); renderRecent(); return; }
  drawn.home = sig;

  const next = open[0];
  $("next").hidden = !next || !S.onHome;
  if (next) {
    put($("next"), 
      el("p", { class: "next-kicker" }, dot(next.level), `Next step · about ${effortOf(next)} minutes`),
      el("h2", {}, next.title),
      el("p", { class: "where" }, whereOf(next)),
      ...fixBody(next, { isNext: true }));
  }
  // Someone you don't recognise outranks any setting: that goes first.
  if (strangers) $("next").before($("door")); else $("next").after($("door"));
  $("door").hidden = !door.length;
  const calm = S.lastCheck && S.onHome && !open.length;
  $("watching-sec").hidden = !calm;
  if (calm) {
    const copies = S.wifi.copies.length;
    put($("watching"), 
      checkRow(true, "Who joins your Wi-Fi", "You'll hear about anyone new within a few minutes.", "Watching"),
      checkRow(true, "Your router", "Something pretending to be your router is caught as it happens.", "Watching"),
      checkRow(!copies, "Fake copies of your Wi-Fi", copies ? "Something nearby uses your Wi-Fi's name. See Wi-Fi." : "Nothing nearby uses your Wi-Fi's name.", copies ? `${copies} nearby` : "None"),
      checkRow(Boolean(S.listening), "Being kicked off the Wi-Fi", "Listened for live, between checks.", S.listening ? "Listening" : "Off"),
      checkRow(true, "Your DNS", "If the address book your computer uses for websites changes, you'll know.", "Watching"));
  }
  $("door-title").textContent = strangers ? "Not recognised" : door.length === 1 ? "Someone new joined your network. Is it yours?" : "Some new devices joined. Are they yours?";
  put($("door-list"), ...door.map(doorRow));
  const rest = open.slice(1);
  $("todo-sec").hidden = !rest.length;
  put($("todo"), ...rest.map((f) => findingRow(f)));
  $("tips-sec").hidden = !tips.length;
  $("tips-n").textContent = tips.length;
  put($("tips"), ...tips.map((f) => findingRow(f, "tip")));
  $("ok-sec").hidden = !oks.length;
  $("ok-n").textContent = oks.length;
  put($("oks"), ...oks.map((f) => findingRow(f, "ok")));
  drawMap();
  renderRecent();
}

function eventRow(a) {
  const when = new Date(a.at * 1000);
  return el("div", { class: `event${a.read ? "" : " unread"}` }, dot(a.level), el("div", {}, el("b", {}, a.title, a.read ? null : el("span", { class: "sr-only" }, " (new)")), el("p", {}, a.body), el("time", { datetime: when.toISOString(), title: when.toLocaleString() }, ago(a.at))));
}
function renderRecent() {
  const sig = JSON.stringify(S.alerts.slice(0, 3).map((a) => [a.id, a.read]));
  if (sig === drawn.recent) return;
  drawn.recent = sig;
  put($("recent"), ...(S.alerts.length ? S.alerts.slice(0, 3).map(eventRow) : [el("p", { class: "empty" }, "Nothing has happened yet.")]));
}

// ---------- Who's here ----------
const GROUPS = ["Your network", "Phones and tablets", "Computers", "TV, cameras and home", "Not sure yet"];
function groupOf(d) {
  const k = d.kind.toLowerCase();
  if (d.isRouter || (k.includes("extender") && !k.includes("on your"))) return 0;
  if (k.includes("phone") || k.includes("tablet") || k.includes("apple")) return 1;
  if (k.includes("computer")) return 2;
  if (/tv|camera|printer|smart-home|streaming/.test(k)) return 3;
  return 4;
}
function deviceRow(d) {
  const problems = S.findings.filter((f) => f.device === d.key && isOpen(f));
  const lvl = worstFor(d.key);
  const sub = [d.kind.toLowerCase() === d.name.toLowerCase() ? null : cap(d.kind), d.vendor && !d.name.includes(d.vendor) ? d.vendor : null, d.behindRepeater && !d.kind.includes("extender") ? "through your extender" : null].filter(Boolean).join(" · ");
  const right = !d.online ? `Last seen ${ago(d.lastSeen)}` : lvl ? LABEL[lvl] : "";
  const tags = [isNew(d) && d.owner == null ? el("span", { class: "tag new" }, "New") : null, d.owner === false ? el("span", { class: "tag unknown" }, "Not recognised") : null];
  const silent = !announced(d) && !d.isSelf && !d.isRouter;
  const ports = (d.deep?.ports || []).map((p) => PORTS[p] || `Port ${p}`);
  const body = el("div", { class: "item-body" },
    problems.length ? el("div", { class: "dev-problems" }, problems.map((f) => el("div", {}, dot(f.level), el("span", {}, f.title), el("button", { class: "link", onclick: () => prefer(f) }, "Show me how")))) : null,
    silent ? el("p", {}, "It doesn't announce a name (many phones hide theirs). Give it one and Porchlight will remember it.") : null,
    ports.length ? el("div", { class: "doors" }, el("span", { class: "muted small" }, "Open to the network:"), ports.map((p) => el("span", { class: "door-chip" }, p))) : null,
    editing === d.key ? renameForm(d, () => { editing = null; }) : el("div", { class: "row" },
      d.isSelf ? null : el("button", { class: "btn quiet small", onclick: () => { editing = d.key; render(true); setTimeout(() => document.querySelector(`[data-key="dev-${CSS.escape(d.key)}"] .rename input`)?.select(), 0); } }, silent ? "Name it" : "Rename"),
      !d.isSelf && !d.isRouter && d.owner == null ? el("button", { class: "btn quiet small", onclick: () => invoke("confirm_device", { key: d.key, mine: true }) }, "It's ours") : null,
      !d.isSelf && !d.isRouter && d.owner !== false ? el("button", { class: "link quiet", onclick: () => { invoke("confirm_device", { key: d.key, mine: false }); go("home"); } }, "I don't know it") : null,
      !d.online ? el("button", { class: "link quiet", onclick: () => invoke("forget_device", { key: d.key }) }, "Forget it") : null),
    el("p", { class: "tech" }, [d.ip, d.mac].filter(Boolean).join("  ·  ")));
  const det = keepOpen(el("details", { class: "item dev" },
    el("summary", {}, avatar(d), el("span", { class: "t" }, el("b", {}, d.name, ...tags), sub ? el("small", {}, sub) : null), el("span", { class: "meta" }, right), ic("chevron", "chev")),
    body), `dev-${d.key}`);
  return el("li", { id: `dev-${d.key}` }, det);
}
function renderDevices(force) {
  if (document.activeElement?.closest?.("#v-devices .rename")) return;
  const list = Object.values(S.devices).filter((d) => devFilter === "all" || d.online);
  const sig = JSON.stringify([list, S.findings, S.accepted, editing, devFilter]);
  if (force !== true && sig === drawn.devices) return;
  drawn.devices = sig;
  const groups = GROUPS.map((title, i) => ({ title, items: list.filter((d) => groupOf(d) === i).sort((a, b) => b.isRouter - a.isRouter || b.isSelf - a.isSelf || a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
  put($("device-groups"), ...(groups.length ? groups.map((g) => el("section", { class: "group" }, el("h2", {}, g.title, el("span", { class: "n" }, g.items.length)), el("ul", { class: "rows" }, g.items.map(deviceRow)))) : [el("p", { class: "empty" }, "No devices yet. The first look takes about a minute.")]));
}
function showDevice(key) {
  openRows.add(`dev-${key}`);
  go("devices");
  render(true);
  setTimeout(() => {
    const n = document.getElementById(`dev-${key}`);
    if (!n) return;
    n.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    n.firstChild.classList.add("flash");
    setTimeout(() => n.firstChild?.classList.remove("flash"), 1600);
  }, 60);
}

// ---------- Wi-Fi ----------
function checkRow(good, title, explain, value) {
  return el("li", { class: `check-row ${good ? "good" : "bad"}` }, ic(good ? "check" : "alert"), el("span", {}, el("b", {}, title), el("small", {}, explain)), el("span", { class: `tag ${good ? "good" : "bad"}` }, value));
}
function renderWifi(force) {
  const w = S.wifi;
  const sig = JSON.stringify([w, S.findings, S.accepted, S.listening, pending, S.busy]);
  if (force !== true && sig === drawn.wifi) return;
  drawn.wifi = sig;
  const weak = (p) => ["Open", "WEP", "WPA", "WPA2 (old TKIP)"].includes(p);
  const source = { home: "Your Wi-Fi", "second network from your router": "A second network from your router", "your extender": "Your extender's network" };
  put($("wifi-nets"), ...(w.yours.length ? w.yours.map((n) => el("div", { class: `panel net${n.source === "home" ? " home" : ""}` },
    el("div", { class: "net-head" }, ic(n.source === "your extender" ? "extender" : "wifi"), el("div", {}, el("b", {}, n.ssid), el("small", {}, source[n.source] || n.source))),
    el("ul", { class: "rows" },
      checkRow(!weak(n.protection), "Password lock", "Keeps strangers off your Wi-Fi.", weak(n.protection) ? `Weak (${n.protection})` : `Strong (${n.protection})`),
      checkRow(n.pmf !== "off", "Protection from fake disconnects", "Stops someone nearby kicking your devices off the Wi-Fi (PMF).", n.pmf === "off" ? "Off" : "On"),
      checkRow(!n.wps, "PIN pairing (WPS)", "An old way to join with an 8-digit PIN that can be guessed on some models.", n.wps ? "On" : "Off")))) : [el("p", { class: "empty" }, w.homeSsid ? "Your Wi-Fi wasn't heard on the last check." : "Choose your Wi-Fi in Settings so Porchlight can watch it.")]));
  put($("wifi-around"), 
    checkRow(!w.copies.length, "Fake copies of your Wi-Fi", w.copies.length ? `Using your Wi-Fi's name: ${w.copies.map((c) => `${c.ssid} (${c.protection})`).join(", ")}. Don't connect to them.` : "Nothing nearby is using your Wi-Fi's name.", w.copies.length ? `${w.copies.length} nearby` : "None"),
    checkRow(!w.savedOpenAuto.length, "Networks this computer joins by itself", w.savedOpenAuto.length ? `Open networks it would join without asking: ${w.savedOpenAuto.map((s) => s.ssid).join(", ")}. Fake hotspots use exactly this.` : `${w.savedCount} saved, none of them open. Fake hotspots can't lure it.`, w.savedOpenAuto.length ? "Worth fixing" : "Safe"),
    checkRow(Boolean(S.listening), "Kick-off watch", S.listening ? "Listening live: Porchlight warns you the moment this computer is pushed off the Wi-Fi again and again." : "Not available on this computer (no Wi-Fi adapter, or Windows didn't allow it). Regular checks still run.", S.listening ? "Listening" : "Off"),
    w.adapters.length ? checkRow(true, "Wi-Fi adapter", `${w.adapters.join(", ")}${w.connected ? `, connected to "${w.connected}"` : ", not connected"}.`, "Working") : null);
  const fs = S.findings.filter((f) => WIFI_IDS.includes(f.id) && isOpen(f));
  $("wifi-todo-sec").hidden = !fs.length;
  put($("wifi-todo"), ...fs.map((f) => findingRow(f)));
}

// ---------- History ----------
function renderAlerts() {
  const sig = JSON.stringify(S.alerts.map((a) => [a.id, a.read]));
  if (sig === drawn.alerts) return;
  drawn.alerts = sig;
  if (!S.alerts.length) { put($("alert-list"), el("p", { class: "empty" }, "Nothing yet. Porchlight will note here everything it notices.")); return; }
  const dayOf = (t) => { const d = new Date(t * 1000); const today = new Date(); const y = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); };
  const days = [];
  for (const a of S.alerts) { const k = dayOf(a.at); if (!days.length || days[days.length - 1].k !== k) days.push({ k, items: [] }); days[days.length - 1].items.push(a); }
  put($("alert-list"), ...days.map((d) => el("section", { class: "day" }, el("h2", {}, d.k), d.items.map(eventRow))));
}

// ---------- Settings ----------
function renderSettings() {
  $("about-version").textContent = `Porchlight ${S.appVersion || ""}`.trim();
  $("u-title").textContent = S.update ? `Porchlight ${S.update} is ready` : `Porchlight ${S.appVersion || ""} is up to date`.replace("  ", " ");
  $("u-install").hidden = !S.update;
  if (document.activeElement?.closest?.(".settings")) return;
  $("s-autostart").checked = S.autostart;
  $("s-notify").checked = S.settings.notify;
  $("s-interval").value = String(S.settings.intervalMin);
  const names = [...new Set([S.settings.homeSsid, S.wifi.connected, ...S.wifi.visible].filter(Boolean))];
  put($("s-ssid"), el("option", { value: "" }, "None"), ...names.map((n) => el("option", { value: n }, n)));
  $("s-ssid").value = S.settings.homeSsid || S.wifi.connected || "";
}

// ---------- everything ----------
function render(force) {
  if (!S) return;
  if (!S.settings.consented) return showWelcome();
  $("welcome").hidden = true;
  $("app").hidden = false;
  const online = Object.values(S.devices).filter((d) => d.online).length;
  const todo = S.onHome ? openFindings().length + atTheDoor().filter((d) => naming !== d.key).length : 0;
  $("n-todo").textContent = todo || "";
  $("n-devices").textContent = online || "";
  const unread = S.alerts.filter((a) => !a.read).length;
  $("n-alerts").textContent = unread || "";
  const watching = S.onHome && S.lastCheck;
  $("watch-text").textContent = S.settings.paused ? "Paused" : S.busy ? "Checking…" : watching ? "Watching quietly" : S.lastCheck ? "Away from home" : "Starting…";
  $("last-check").textContent = S.busy ? S.progress || "" : S.lastCheck ? `Checked ${ago(S.lastCheck)}` : "";
  $("watch-dot").className = `dot-live${S.busy ? " busy" : watching ? "" : " off"}`;
  $("update-banner").hidden = !S.update;
  $("update-text").textContent = S.update ? `Porchlight ${S.update} is ready: newer checks and fixes.` : "";
  $("away").hidden = !S.lastCheck || S.onHome;
  $("away").textContent = S.status;
  // One view failing must never blank the others.
  for (const view of [renderHome, renderDevices, renderWifi, renderAlerts, renderSettings]) {
    try { view(force); } catch (e) { console.error(`${view.name} failed`, e); }
  }
}

function go(v) {
  for (const b of document.querySelectorAll(".nav")) {
    b.classList.toggle("on", b.dataset.view === v);
    if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const s of document.querySelectorAll(".view")) {
    const on = s.id === `v-${v}`;
    s.hidden = !on;
    s.classList.toggle("enter", on);
  }
  $("main").scrollTop = 0;
  if (v === "alerts") setTimeout(() => invoke("mark_read"), 1500);
}

// After "I did it, check again": say whether it worked.
function settlePending() {
  if (!pending || S.busy || (S.lastCheck || 0) <= pending.since) return;
  const still = S.findings.some((f) => fkey(f) === pending.key);
  if (still) { pending.result = "still"; pending.since = S.lastCheck; return; }
  const left = openFindings().length;
  toast(`Fixed: ${pending.title}. ${left ? `${cap(count(left, "thing"))} left.` : "That was the last one."}`);
  pending = null;
}

// ---------- events ----------
for (const b of document.querySelectorAll(".nav")) b.addEventListener("click", () => go(b.dataset.view));
for (const b of document.querySelectorAll("[data-goto]")) b.addEventListener("click", () => go(b.dataset.goto));
for (const b of document.querySelectorAll("[data-dev]")) b.addEventListener("click", () => { devFilter = b.dataset.dev; for (const x of document.querySelectorAll("[data-dev]")) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); } renderDevices(true); });
$("check-now").addEventListener("click", () => invoke("check_now", { full: true }));
$("mark-read").addEventListener("click", () => invoke("mark_read"));
const saveSettings = () => invoke("set_settings", { intervalMin: Number($("s-interval").value), notify: $("s-notify").checked, homeSsid: $("s-ssid").value || null, autostart: $("s-autostart").checked });
for (const id of ["s-autostart", "s-notify", "s-interval", "s-ssid"]) $(id).addEventListener("change", saveSettings);
$("s-router").addEventListener("click", () => invoke("accept_router").then(() => toast("Okay. Porchlight will learn your new router on the next check.")));
$("s-home").addEventListener("click", () => invoke("set_home_here"));
$("s-forget").addEventListener("click", async () => {
  const b = $("s-forget");
  if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Click again to delete everything"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Forget everything"; }, 4000); return; }
  await invoke("forget_everything");
});
const install = async (b) => {
  b.disabled = true;
  b.textContent = "Installing…";
  try { await invoke("install_update"); } catch (e) { b.disabled = false; b.textContent = "Install update"; $("u-text").textContent = String(e); }
};
$("update-go").addEventListener("click", (e) => install(e.currentTarget));
$("u-install").addEventListener("click", (e) => install(e.currentTarget));
$("u-check").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = "Checking…";
  const v = await invoke("check_update").catch(() => null);
  b.disabled = false;
  b.textContent = "Check for updates";
  $("u-text").textContent = v ? "A signed update is ready. Install it whenever you like." : "You have the latest version. Porchlight checks again tomorrow.";
});
$("h-issue").addEventListener("click", () => invoke("open_link", { which: "issues" }));
$("p-notes").addEventListener("click", () => invoke("open_link", { which: "privacy" }));
$("h-diag").addEventListener("click", async () => {
  try { const path = await invoke("export_diagnostics"); $("h-done").textContent = `Saved to ${path}. Attach it to your report.`; }
  catch (e) { $("h-done").textContent = `Couldn't save the file: ${e}`; }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (editing || naming)) { editing = null; naming = null; render(true); } });

T.event.listen("state", (e) => { S = e.payload; settlePending(); render(); });
invoke("get_state").then((s) => { S = s; render(true); go("home"); });
setInterval(() => S && render(), 60_000);
