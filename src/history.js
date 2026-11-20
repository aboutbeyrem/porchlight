// Remembers, on this computer only, which devices and problems the last checkup saw, so the next one can say
// "a new device joined" and "you fixed this". Stored in ~/.porchlight/history.json; nothing is ever uploaded.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHECKS } from "./catalog.js";

const officeOnly = (id) => CHECKS.find((c) => c.id === id)?.profile === "office";

export const dataDir = () => process.env.PORCHLIGHT_DATA || path.join(os.homedir(), ".porchlight");
const file = () => path.join(dataDir(), "history.json");
const VERSION = 2; // older files are ignored, not misread

export function loadHistory() {
  try {
    const h = JSON.parse(fs.readFileSync(file(), "utf8"));
    return h && h.version === VERSION && h.networks ? h : { version: VERSION, networks: {} };
  } catch {
    return { version: VERSION, networks: {} };
  }
}

export function saveHistory(h) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(h, null, 1));
    return true;
  } catch {
    return false;
  }
}

export function forgetHistory() {
  try { fs.rmSync(file()); return true; } catch { return false; }
}

// One entry per home network: the same subnet behind the same router.
export function networkKey(net, devices) {
  const router = devices.find((d) => d.isRouter);
  return `${net.cidr}|${router?.mac || net.gateway}`;
}

// A device is known by its MAC address. Devices behind a repeater share the repeater's MAC, so for them the
// address is part of the key.
const deviceKey = (d) => (d.mac ? (d.sharedMac ? `${d.mac.toLowerCase()}@${d.ip}` : d.mac.toLowerCase()) : null);
export const problemKey = (f, devices) => {
  const d = f.device ? devices.find((x) => x.ip === f.device) : null;
  return `${f.title}|${(d && deviceKey(d)) || f.device || ""}`;
};
const isProblem = (f) => f.level === "fix-soon" || f.level === "worth-fixing";

// What changed since the last checkup on this network. A problem only counts as fixed when we could look again:
// its device answered this time, and its Wi-Fi network was heard (a sleeping extender isn't a fixed one).
// ran: what this checkup could see. Office-only checks don't run in the home profile, and the known-devices check
// needs a policy, so their old problems can't be called fixed by a run that didn't look.
export function compare(entry, devices, findings, heardSsids = new Set(), ran = { profile: "home", inventory: false }) {
  if (!entry) return { firstRun: true, since: null, newDevices: [], fixed: [], unverified: [] };
  const known = new Set(Object.keys(entry.devices || {}));
  const newDevices = devices.filter((d) => !d.self && !d.isRouter && deviceKey(d) && !known.has(deviceKey(d)));
  const now = new Set(findings.filter(isProblem).map((f) => problemKey(f, devices)));
  const seen = new Set(devices.flatMap((d) => [deviceKey(d), d.ip]).filter(Boolean));
  const checkRan = (p) => (p.profile !== "office" || ran.profile === "office") && (p.id !== "PL-UNKNOWN-DEVICE" || ran.inventory);
  const lookedAgain = (p) => checkRan(p) && (!p.device || seen.has(p.device)) && (!p.ssid || heardSsids.has(p.ssid));
  const gone = (entry.problems || []).filter((p) => !now.has(p.key));
  return { firstRun: false, since: entry.lastRun, newDevices, fixed: gone.filter(lookedAgain), unverified: gone.filter((p) => !lookedAgain(p)) };
}

// carry: problems we couldn't look at again this time; they're kept so a later fix is still noticed.
export function updateEntry(entry, devices, findings, when, nameOf = (d) => d.ip, carry = []) {
  const next = { lastRun: when, devices: { ...(entry?.devices || {}) }, problems: [] };
  for (const d of devices) {
    const k = deviceKey(d);
    if (!k || d.self) continue;
    const old = next.devices[k];
    next.devices[k] = { name: nameOf(d), ip: d.ip, firstSeen: old?.firstSeen || when, lastSeen: when };
  }
  next.problems = findings.filter(isProblem).map((f) => {
    const d = f.device ? devices.find((x) => x.ip === f.device) : null;
    return { key: problemKey(f, devices), id: f.id || null, profile: officeOnly(f.id) ? "office" : "any", title: f.title, deviceName: f.deviceName, device: (d && deviceKey(d)) || f.device || null, ssid: f.ssid || null };
  });
  next.problems.push(...carry.filter((p) => !next.problems.some((q) => q.key === p.key)));
  return next;
}
