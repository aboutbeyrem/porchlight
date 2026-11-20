// Porchlight for Windows: the window. Text goes in with textContent and SVG is built with the DOM, so nothing from
// the network is ever parsed as HTML. The Rust side does all the watching.
const T = window.__TAURI__;
const invoke = (cmd, args) => T.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know", "all-good": "All good" };
let S = null;
let devFilter = "online";
let editing = null;
let mapDrawnFor = "";
const WIFI_IDS = ["PL-WIFI-WEAK", "PL-WPS", "PL-NO-PMF", "PL-EVIL-TWIN", "PL-SSID-DUPLICATE", "PL-SAVED-OPEN", "PL-SAVED-HIDDEN"];

// ---------- icons: one family, 24px grid, 1.75 stroke ----------
const ICONS = {
  shield: { p: ["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9C7.7 19.8 4.5 16.1 4.5 11.5V6z", "M9 12l2.2 2.2L15.5 10"] },
  devices: { r: [[2.5, 5, 13, 9.5, 1.5], [17.5, 8, 4.5, 11.5, 1.2]], p: ["M6 18.5h6", "M9 14.5v4"] },
  wifi: { p: ["M2.5 9a14 14 0 0 1 19 0", "M5.8 12.6a9.4 9.4 0 0 1 12.4 0", "M9.1 16.1a4.6 4.6 0 0 1 5.8 0", "M12 19.6h.01"] },
  bell: { p: ["M6 16.5v-5a6 6 0 0 1 12 0v5l1.6 2H4.4z", "M10 20.5a2 2 0 0 0 4 0"] },
  sliders: { p: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9"], c: [[15, 7, 2], [9, 17, 2]] },
  refresh: { p: ["M20 12a8 8 0 1 1-2.6-5.9", "M20 4.5V9h-4.5"] },
  scan: { p: ["M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8", "M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8", "M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16", "M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16", "M4 12h16"] },
  eye: { p: ["M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"], c: [[12, 12, 2.8]] },
  lock: { r: [[5, 10.5, 14, 10, 2]], p: ["M8 10.5V8a4 4 0 0 1 8 0v2.5"] },
  chat: { p: ["M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z", "M8 9.5h8", "M8 12.5h5"] },
  alert: { p: ["M12 4l9 15.5H3z", "M12 10v4", "M12 17h.01"] },
  info: { c: [[12, 12, 9]], p: ["M12 11v5", "M12 8h.01"] },
  check: { c: [[12, 12, 9]], p: ["M8.5 12.3l2.3 2.3 4.7-4.8"] },
  urgent: { p: ["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9C7.7 19.8 4.5 16.1 4.5 11.5V6z", "M12 8.5v4.5", "M12 16h.01"] },
  pencil: { p: ["M4.5 19.5h4l10-10-4-4-10 10z", "M13 7.5l4 4"] },
  trash: { p: ["M5 7h14", "M9.5 7V4.5h5V7", "M7 7l1 12.5h8L17 7"] },
  chevron: { p: ["M7 10l5 5 5-5"] },
  // device types
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
const ic = (name, extra = "") => { const s = el("span", { class: `ic ${extra}` }); s.append(icon(name)); return s; };
for (const n of document.querySelectorAll("[data-icon]")) n.append(icon(n.dataset.icon));

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

const ago = (t) => {
  if (!t) return "never";
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
};
const worstFor = (key) => {
  const fs = (S?.findings || []).filter((f) => f.device === key).map((f) => f.level);
  return ["fix-soon", "worth-fixing"].find((l) => fs.includes(l)) || "";
};
const isNew = (d) => S.baselineAt && !d.isSelf && d.firstSeen > S.baselineAt && Date.now() / 1000 - d.firstSeen < 7 * 86400;

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
  $("w-ssid").replaceChildren(el("option", { value: "" }, names.length ? "Choose your Wi-Fi…" : "No Wi-Fi adapter (skip)"), ...names.map((n) => el("option", { value: n }, n + (n === info.connected ? "  (connected)" : ""))));
  if (info.connected) $("w-ssid").value = info.connected;
  const ready = () => ($("w-start").disabled = !$("w-ok").checked || !info.network);
  $("w-ok").onchange = ready;
  ready();
}
$("w-start").addEventListener("click", async () => {
  $("w-start").disabled = true;
  await invoke("start_watching", { homeSsid: $("w-ssid").value || null });
});

// ---------- the network map ----------
// The router in the middle; devices on rings around it, the ones that need attention closest; devices behind an
// extender fanned out beside it. Rings hold 10, 16, 22 and 28 devices, so about 75 stay readable; past that, a
// "+N" node opens the device list. One Tab stop: the arrow keys move between devices.
const RINGS = [10, 16, 22, 28];

function mapLayout(all) {
  const extender = all.find((d) => d.kind === "Wi-Fi extender");
  const behindExt = (d) => d.behindRepeater && extender;
  const rank = (d) => ({ "fix-soon": 0, "worth-fixing": 1 })[worstFor(d.key)] ?? 2;
  const order = (a, b) => rank(a) - rank(b) || (b === extender) - (a === extender) || a.name.localeCompare(b.name);
  const direct = all.filter((d) => !behindExt(d)).sort(order);
  const behind = all.filter(behindExt).sort(order);
  const cap = RINGS.reduce((a, b) => a + b, 0);
  const shown = direct.slice(0, direct.length > cap ? cap - 1 : cap);
  const more = direct.length - shown.length;
  const items = more ? [...shown, { more }] : shown;
  let k = 1;
  while (RINGS.slice(0, k).reduce((a, b) => a + b, 0) < items.length) k++;
  const total = RINGS.slice(0, k).reduce((a, b) => a + b, 0);
  const pos = new Map();
  const nodes = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const count = i === k - 1 ? items.length - at : Math.round((items.length * RINGS[i]) / total);
    const ring = items.slice(at, at + count);
    at += count;
    const [rx, ry] = k === 1 ? [150, 102] : [112 + i * 62, 78 + i * 44];
    const r = k === 1 ? 19 : i === 0 ? 16 : 13;
    ring.forEach((d, j) => {
      const a = -Math.PI / 2 + (j / ring.length) * Math.PI * 2 + (ring.length % 2 ? 0 : Math.PI / ring.length) + i * 0.35;
      const p = [Math.cos(a) * rx, Math.sin(a) * ry];
      if (d.key) pos.set(d.key, p);
      nodes.push({ d, p, r, parent: [0, 0], sub: false, label: k === 1 });
    });
  }
  if (extender && pos.has(extender.key)) {
    const [ex, ey] = pos.get(extender.key);
    const out = Math.atan2(ey, ex);
    const reach = 58 + Math.max(0, behind.length - 5) * 7;
    const step = Math.min(0.62, (Math.PI * 1.4) / Math.max(behind.length - 1, 1));
    behind.forEach((d, i) => {
      const a = out + (i - (behind.length - 1) / 2) * step;
      nodes.push({ d, p: [ex + Math.cos(a) * reach, ey + Math.sin(a) * reach * 0.8], r: behind.length > 8 ? 12 : 15, parent: [ex, ey], sub: true, label: false });
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
  // Fit the drawing: everything plus room for labels, never smaller than the default view.
  const xs = nodes.map((n) => n.p[0]), ys = nodes.map((n) => n.p[1]);
  const half = [Math.max(220, ...xs.map(Math.abs).map((v) => v + 46)), Math.max(150, ...ys.map(Math.abs).map((v) => v + 38))];
  svg.setAttribute("viewBox", `${-half[0]} ${-half[1]} ${half[0] * 2} ${half[1] * 2}`);
  svg.setAttribute("aria-label", `Map of your home network: ${all.length} device${all.length === 1 ? "" : "s"} around your router. Use the arrow keys to move between them.`);
  svg.replaceChildren();
  const defs = svgEl("defs");
  const grad = svgEl("radialGradient", { id: "halo" });
  grad.append(svgEl("stop", { offset: "0", "stop-color": "#f5b62a", "stop-opacity": "0.35" }), svgEl("stop", { offset: "1", "stop-color": "#f5b62a", "stop-opacity": "0" }));
  defs.append(grad);
  svg.append(defs, svgEl("circle", { class: "halo", cx: 0, cy: 0, r: 120 }));
  for (const n of nodes) svg.append(svgEl("line", { class: `link-line${n.sub ? " sub" : ""}`, x1: n.parent[0], y1: n.parent[1], x2: n.p[0], y2: n.p[1] }));

  const focusable = [];
  const node = (d, [x, y], r, i, { isRouter = false, label = false } = {}) => {
    const lvl = d.key ? worstFor(d.key) : "";
    const name = d.more ? `${d.more} more device${d.more === 1 ? "" : "s"}` : d.name;
    const spoken = d.more ? `${name}: open the device list` : `${name}, ${isRouter ? "your router" : d.kind}${lvl ? `, ${LABEL[lvl].toLowerCase()}` : ""}`;
    const g = svgEl("g", { class: `node${isRouter ? " router" : ""}${d.more ? " more" : ""}${first ? " appear" : ""}`, transform: `translate(${x} ${y})`, tabindex: "-1", role: "button", "aria-label": spoken });
    g.style.setProperty("--i", Math.min(i, 12));
    g.style.transformOrigin = `${x}px ${y}px`;
    g.append(svgEl("circle", { class: "bg", r }));
    if (lvl) g.append(svgEl("circle", { class: `ring ${lvl}`, r: r + 3.5 }));
    if (d.more) {
      const t = svgEl("text", { class: "more-n", y: 4 });
      t.textContent = `+${d.more}`;
      g.append(t);
    } else {
      const glyph = icon(KIND_ICON(isRouter ? "router" : d.kind));
      const s = r * 1.05;
      Object.entries({ x: -s / 2, y: -s / 2, width: s, height: s, class: "icon glyph" }).forEach(([k, v]) => glyph.setAttribute(k, v));
      g.append(glyph);
    }
    const tip = svgEl("title");
    tip.textContent = d.more ? name : `${d.name} · ${d.ip}`;
    g.append(tip);
    if (label || isRouter) {
      const text = isRouter ? "Router" : d.name;
      const t = svgEl("text", { y: r + 15 });
      t.textContent = text.length > 16 ? `${text.slice(0, 15)}…` : text;
      g.append(t);
    }
    const open = () => { go("devices"); if (!d.more) flashDevice(d.key); };
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
  if (router) node(router, [0, 0], 30, 0, { isRouter: true });
  nodes.forEach((n, i) => node(n.d, n.p, n.r, i + 1, { label: n.label }));
  focusable[0]?.setAttribute("tabindex", "0");
}

// ---------- pieces ----------
function findingCard(f, open = false) {
  const dev = f.device && S.devices[f.device];
  const lvlIcon = f.level === "fix-soon" ? "urgent" : f.level === "worth-fixing" ? "alert" : "info";
  return el("details", { class: `card finding ${f.level}`, open },
    el("summary", {}, ic(lvlIcon, "lvl"),
      el("div", {}, el("h3", {}, f.title), el("span", { class: "sub" }, dev ? `${dev.name} · ${dev.ip}` : LABEL[f.level])),
      ic("chevron", "chev")),
    el("dl", { class: "body" },
      el("div", {}, el("dt", {}, "What we found"), el("dd", {}, f.found)),
      el("div", {}, el("dt", {}, "What that means"), el("dd", {}, f.means)),
      el("div", {}, el("dt", {}, "How likely it matters"), el("dd", {}, f.likely)),
      f.fix.length ? el("div", {}, el("dt", {}, "How to fix it"), el("dd", {}, el("ol", {}, f.fix.map((s) => el("li", {}, s))))) : null));
}
function eventRow(a) {
  const name = a.level === "urgent" ? "urgent" : a.level === "warning" ? "alert" : "check";
  const when = new Date(a.at * 1000);
  return el("div", { class: `event ${a.level}${a.read ? "" : " unread"}` }, ic(name), el("div", {}, el("b", {}, a.title, a.read ? null : el("span", { class: "sr-only" }, " (new)")), el("p", {}, a.body), el("time", { datetime: when.toISOString(), title: when.toLocaleString() }, ago(a.at))));
}

// ---------- views ----------
function renderOverview() {
  const problems = S.findings.filter((f) => f.level === "fix-soon" || f.level === "worth-fixing");
  const devices = Object.values(S.devices);
  const online = devices.filter((d) => d.online);
  const value = S.lastCheck ? S.score : null;
  const c = 2 * Math.PI * 52;
  $("score-value").textContent = value ?? "–";
  $("score-arc").style.strokeDasharray = `${((value ?? 0) / 100) * c} ${c}`;
  $("score").className = `score ${value == null || value >= 90 ? "" : value >= 70 ? "ok" : "low"}`;
  $("score").setAttribute("aria-label", value == null ? "No score yet" : `Safety score ${value} out of 100`);
  $("score-label").textContent = value == null ? "Getting ready" : value >= 90 ? "Well protected" : value >= 70 ? "A few things to tidy up" : value >= 45 ? "Needs some attention" : "Start with the top items";
  $("headline").textContent = !S.lastCheck ? "Taking a first look…" : problems.length ? `${problems.length} thing${problems.length > 1 ? "s" : ""} worth fixing` : "Your home looks well protected";
  $("subline").textContent = S.lastCheck ? `Watching ${online.length} devices on ${S.network?.cidr || "your network"}. Last check ${ago(S.lastCheck)}, full checkup ${ago(S.lastFull)}.` : "The first look takes about a minute.";
  const newWeek = devices.filter(isNew).length;
  const home = S.wifi.yours[0];
  const tile = (iconName, value, label) => el("div", { class: "card tile" }, el("b", {}, value), el("span", {}, label), ic(iconName));
  $("tiles").replaceChildren(
    tile("devices", online.length, "devices online"),
    tile("bell", newWeek, newWeek === 1 ? "new device this week" : "new devices this week"),
    tile("wifi", home ? home.protection : "–", home ? `on "${home.ssid}"` : "Wi-Fi protection"),
    tile("shield", S.alerts.filter((a) => !a.read).length, "unread alerts"));
  $("att-count").textContent = problems.length ? `${problems.length} open` : "";
  $("attention").replaceChildren(...(problems.length ? problems.map((f, i) => findingCard(f, i === 0)) : [el("p", { class: "empty" }, S.lastCheck ? "Nothing needs fixing right now. Porchlight keeps watching." : "Porchlight is taking its first look.")]));
  const wifiIds = new Set(WIFI_IDS);
  const tips = S.findings.filter((f) => f.level === "good-to-know" && !wifiIds.has(f.id));
  $("tips-head").hidden = !tips.length;
  $("tips").replaceChildren(...tips.map((f) => findingCard(f)));
  $("recent").replaceChildren(...(S.alerts.length ? S.alerts.slice(0, 5).map(eventRow) : [el("p", { class: "empty" }, "Nothing has happened yet.")]));
  drawMap();
}

function renderDevices() {
  // A check finishing must not wipe a name being typed.
  if (document.activeElement?.closest?.(".rename")) return;
  const portName = { 21: "FTP", 22: "SSH", 23: "Telnet", 80: "Web page", 443: "Web page (https)", 445: "File sharing", 554: "Video stream", 1883: "MQTT", 2323: "Telnet", 2375: "Docker", 3389: "Remote Desktop", 5555: "Android debugging", 5900: "VNC", 8000: "Web page", 8080: "Web page", 8554: "Video stream", 34567: "XMEye", 37777: "Dahua" };
  const list = Object.values(S.devices).filter((d) => devFilter === "all" || d.online).sort((a, b) => b.isRouter - a.isRouter || b.isSelf - a.isSelf || (a.ip || "").localeCompare(b.ip || "", undefined, { numeric: true }));
  $("device-list").replaceChildren(...(list.length ? list.map((d) => {
    const meta = [d.kind.toLowerCase() === d.name.toLowerCase() ? null : d.kind, d.behindRepeater && !d.kind.includes("extender") ? "via your extender" : null, d.vendor && !d.name.includes(d.vendor) ? d.vendor : null, d.ip].filter(Boolean).join(" · ");
    const when = d.isSelf ? null : d.online ? `First seen ${ago(d.firstSeen)}` : `Last seen ${ago(d.lastSeen)}`;
    const announced = d.customName || d.upnpName || d.serviceName || d.detectedName || d.webTitle || d.routerName;
    const silent = !announced && !d.isSelf && !d.isRouter;
    const lvl = d.online ? worstFor(d.key) : "offline";
    const avatar = el("div", { class: "avatar" }, icon(KIND_ICON(d.kind)), el("span", { class: `state ${lvl}`, title: lvl ? LABEL[lvl] || "Offline" : "No problems found" }));
    const name = editing === d.key
      ? el("form", { class: "rename", onsubmit: async (e) => { e.preventDefault(); editing = null; await invoke("rename_device", { key: d.key, name: e.target.elements.n.value }); } },
          el("input", { name: "n", value: d.customName || d.name, maxlength: "40", "aria-label": "Device name" }), el("button", { class: "btn primary", type: "submit" }, "Save"))
      : el("div", { class: "name" }, d.name, isNew(d) ? el("span", { class: "badge" }, "NEW") : null);
    return el("div", { class: `card device${d.isRouter ? " router" : ""}`, id: `dev-${d.key}` },
      avatar,
      el("div", {}, name, el("div", { class: "meta" }, meta), when ? el("div", { class: "meta" }, when) : null,
        silent && editing !== d.key ? el("div", { class: "meta hint" }, "It doesn’t announce a name (many phones hide theirs). Give it one and Porchlight will remember it.") : null,
        d.deep?.ports?.length ? el("div", { class: "doors" }, d.deep.ports.map((p) => el("span", { class: "door" }, portName[p] || `Port ${p}`))) : null,
        d.isSelf || editing === d.key ? null : el("div", { class: "actions" },
          el("button", { class: "link", onclick: () => { editing = d.key; render(); setTimeout(() => document.querySelector(".rename input")?.select(), 0); } }, ic("pencil"), silent ? " Name it" : " Rename"),
          !d.online ? el("button", { class: "link", onclick: () => invoke("forget_device", { key: d.key }) }, ic("trash"), " Forget") : null)));
  }) : [el("p", { class: "empty" }, "No devices yet.")]));
}
function flashDevice(key) {
  setTimeout(() => {
    const n = document.getElementById(`dev-${key}`);
    if (!n) return;
    n.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    n.classList.add("flash");
    setTimeout(() => n.classList.remove("flash"), 1600);
  }, 60);
}

function renderWifi() {
  const w = S.wifi;
  const tag = (good, yes, no) => el("span", { class: `tag ${good ? "good" : "worth-fixing"}` }, good ? yes : no);
  const cards = w.yours.map((n) => el("div", { class: `card wcard${n.source === "home" ? " home" : ""}` },
    el("div", { class: "wcard-head" }, ic(n.source === "your extender" ? "extender" : "wifi"), el("div", {}, el("h3", {}, n.ssid), el("span", { class: "src" }, n.source === "home" ? "Your Wi-Fi" : n.source))),
    el("ul", { class: "checks-list" },
      el("li", {}, "Protection", tag(!["Open", "WEP", "WPA", "WPA2 (old TKIP)"].includes(n.protection), n.protection, n.protection)),
      el("li", {}, "Kick-off protection", tag(n.pmf !== "off", n.pmf === "required" ? "Required" : "On", "Off")),
      el("li", {}, "WPS (PIN pairing)", tag(!n.wps, "Off", "On")))));
  cards.push(el("div", { class: "card wcard" }, el("div", { class: "wcard-head" }, ic("eye"), el("div", {}, el("h3", {}, "Fake copies nearby"), el("span", { class: "src" }, "Access points using your Wi-Fi's name"))),
    el("p", {}, w.copies.length ? `${w.copies.length} found: ${w.copies.map((c) => `${c.ssid} (${c.protection})`).join(", ")}.` : w.homeSsid ? "None right now. Porchlight checks every few minutes." : "Choose your Wi-Fi in Settings to watch for copies."),
    tag(!w.copies.length, "All clear", `${w.copies.length} to look at`)));
  cards.push(el("div", { class: "card wcard" }, el("div", { class: "wcard-head" }, ic("lock"), el("div", {}, el("h3", {}, "Saved networks"), el("span", { class: "src" }, `${w.savedCount} saved on this computer`))),
    el("p", {}, w.savedOpenAuto.length ? `Joins ${w.savedOpenAuto.length} open network${w.savedOpenAuto.length > 1 ? "s" : ""} by itself: ${w.savedOpenAuto.map((s) => s.ssid).join(", ")}.` : "Doesn't join any open network by itself, so fake hotspots (MANA attacks) can't lure it."),
    tag(!w.savedOpenAuto.length, "Protected", "Worth fixing")));
  cards.push(el("div", { class: "card wcard" }, el("div", { class: "wcard-head" }, ic("bell"), el("div", {}, el("h3", {}, "Kick-off watch"), el("span", { class: "src" }, "Live, between checks"))),
    el("p", {}, S.listening ? "Porchlight listens for this computer being pushed off the Wi-Fi again and again, the first step of many Wi-Fi attacks, and warns you the moment it happens." : "Live listening isn’t available on this computer (no Wi-Fi adapter, or Windows didn’t allow it). Regular checks still run."),
    tag(S.listening, "Listening", "Off")));
  if (w.adapters.length) cards.push(el("div", { class: "card wcard" }, el("div", { class: "wcard-head" }, ic("chip"), el("div", {}, el("h3", {}, "Wi-Fi adapter"), el("span", { class: "src" }, w.connected ? `Connected to "${w.connected}"` : "Listening, not connected"))), el("p", {}, w.adapters.join(", "))));
  $("wifi-cards").replaceChildren(...cards);
  const fs = S.findings.filter((f) => WIFI_IDS.includes(f.id));
  $("wifi-findings").replaceChildren(...(fs.length ? fs.map((f) => findingCard(f)) : [el("p", { class: "empty" }, S.lastCheck ? "Your Wi-Fi looks fine." : "Waiting for the first check.")]));
}

function renderAlerts() {
  $("alert-list").replaceChildren(...(S.alerts.length ? S.alerts.map(eventRow) : [el("p", { class: "empty" }, "No alerts yet. Porchlight will let you know when something changes.")]));
}

function renderSettings() {
  $("about-version").textContent = `Porchlight ${S.appVersion || ""}`.trim();
  $("u-title").textContent = S.update ? `Porchlight ${S.update} is ready` : `Porchlight ${S.appVersion || ""} is up to date`.replace("  ", " ");
  $("u-install").hidden = !S.update;
  if (document.activeElement?.closest?.(".settings-group")) return;
  $("s-autostart").checked = S.autostart;
  $("s-notify").checked = S.settings.notify;
  $("s-interval").value = String(S.settings.intervalMin);
  const names = [...new Set([S.settings.homeSsid, S.wifi.connected, ...S.wifi.visible].filter(Boolean))];
  $("s-ssid").replaceChildren(el("option", { value: "" }, "None"), ...names.map((n) => el("option", { value: n }, n)));
  $("s-ssid").value = S.settings.homeSsid || S.wifi.connected || "";
}

function render() {
  if (!S) return;
  if (!S.settings.consented) return showWelcome();
  $("welcome").hidden = true;
  $("app").hidden = false;
  const online = Object.values(S.devices).filter((d) => d.online).length;
  $("n-devices").textContent = online || "";
  const unread = S.alerts.filter((a) => !a.read).length;
  $("n-alerts").textContent = unread || "";
  const watching = S.onHome && S.lastCheck;
  $("watch-text").textContent = S.settings.paused ? "Paused" : S.busy ? "Checking…" : watching ? "Watching" : S.lastCheck ? "Away from home" : "Starting…";
  $("watch-dot").className = `dot-live${watching ? "" : " off"}`;
  $("last-check").textContent = S.lastCheck ? `Last check ${ago(S.lastCheck)}` : "";
  $("tb-status").textContent = S.status || "";
  $("busy").hidden = !S.busy;
  $("busy-text").textContent = S.progress ? `${S.progress}…` : "Checking…";
  $("check-now").disabled = $("full-check").disabled = S.busy;
  $("update-banner").hidden = !S.update;
  $("update-text").textContent = S.update ? `Porchlight ${S.update} is ready: newer checks and fixes.` : "";
  $("away").hidden = !S.lastCheck || S.onHome;
  $("away").textContent = S.status;
  renderOverview();
  renderDevices();
  renderWifi();
  renderAlerts();
  renderSettings();
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

// ---------- events ----------
for (const b of document.querySelectorAll(".nav")) b.addEventListener("click", () => go(b.dataset.view));
for (const b of document.querySelectorAll("[data-goto]")) b.addEventListener("click", () => go(b.dataset.goto));
for (const b of document.querySelectorAll("[data-dev]")) b.addEventListener("click", () => { devFilter = b.dataset.dev; for (const x of document.querySelectorAll("[data-dev]")) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); } renderDevices(); });
$("see-devices").addEventListener("click", () => go("devices"));
$("check-now").addEventListener("click", () => invoke("check_now", { full: false }));
$("full-check").addEventListener("click", () => invoke("check_now", { full: true }));
$("mark-read").addEventListener("click", () => invoke("mark_read"));
const saveSettings = () => invoke("set_settings", { intervalMin: Number($("s-interval").value), notify: $("s-notify").checked, homeSsid: $("s-ssid").value || null, autostart: $("s-autostart").checked });
for (const id of ["s-autostart", "s-notify", "s-interval", "s-ssid"]) $(id).addEventListener("change", saveSettings);
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
  catch (e) { $("h-done").textContent = `Couldn’t save the file: ${e}`; }
});
$("s-router").addEventListener("click", () => invoke("accept_router"));
$("s-home").addEventListener("click", () => invoke("set_home_here"));
$("s-forget").addEventListener("click", async () => {
  const b = $("s-forget");
  if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Click again to delete everything"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Forget everything"; }, 4000); return; }
  await invoke("forget_everything");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && editing) { editing = null; render(); } });

T.event.listen("state", (e) => { S = e.payload; render(); });
invoke("get_state").then((s) => { S = s; render(); go("overview"); });
setInterval(() => S && render(), 60_000);
