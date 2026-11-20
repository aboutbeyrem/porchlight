// An office's checkup policy: which profile and ranges, who authorised the check, which devices are known, and
// which findings have been reviewed and accepted (with a reason and an end date). A plain JSON file.
import fs from "node:fs";
import { parseRanges } from "./ranges.js";
import { LEVELS } from "./findings.js";

export const EXAMPLE = {
  organization: "Example Ltd",
  profile: "office",
  authorizedBy: "Jane Doe, IT manager",
  ranges: ["192.168.10.0/24"],
  extraPorts: [8081],
  failOn: "worth-fixing",
  knownDevices: [
    { mac: "aa:bb:cc:dd:ee:01", name: "Reception printer" },
    { ip: "192.168.10.5", name: "File server" },
  ],
  accepted: [
    { id: "PL-CERT-SELFSIGNED", device: "192.168.10.20", reason: "Printer admin page, internal only", until: "2027-06-30", by: "Jane Doe" },
  ],
};

const MAC = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

// Returns a clean policy or throws one plain-language error listing every problem.
export function validatePolicy(p) {
  const errors = [];
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("The policy file must be a JSON object.");
  const out = { organization: null, profile: "home", authorizedBy: null, ranges: [], extraPorts: [], failOn: null, knownDevices: [], accepted: [] };
  if (p.organization != null) out.organization = String(p.organization).slice(0, 120);
  if (p.profile != null) {
    if (!["home", "office"].includes(p.profile)) errors.push(`"profile" must be "home" or "office".`);
    else out.profile = p.profile;
  }
  if (p.authorizedBy != null) out.authorizedBy = String(p.authorizedBy).slice(0, 120);
  if (p.ranges != null) {
    if (!Array.isArray(p.ranges)) errors.push(`"ranges" must be a list, like ["192.168.10.0/24"].`);
    else {
      try { parseRanges(p.ranges); out.ranges = p.ranges.map(String); } catch (e) { errors.push(e.message); }
      if (p.ranges.length && !out.authorizedBy) errors.push(`Checking "ranges" needs "authorizedBy": the name of the person who authorised it.`);
    }
  }
  if (p.extraPorts != null) {
    if (!Array.isArray(p.extraPorts) || !p.extraPorts.every((n) => Number.isInteger(n) && n > 0 && n < 65536)) errors.push(`"extraPorts" must be a list of port numbers.`);
    else out.extraPorts = p.extraPorts.slice(0, 50);
  }
  if (p.failOn != null) {
    if (!LEVELS.slice(0, 3).includes(p.failOn)) errors.push(`"failOn" must be "fix-soon", "worth-fixing" or "good-to-know".`);
    else out.failOn = p.failOn;
  }
  for (const [i, d] of (Array.isArray(p.knownDevices) ? p.knownDevices : []).entries()) {
    if (!d || (!d.mac && !d.ip)) { errors.push(`knownDevices[${i}] needs a "mac" or an "ip".`); continue; }
    if (d.mac && !MAC.test(d.mac)) { errors.push(`knownDevices[${i}]: "${d.mac}" isn't a MAC address.`); continue; }
    out.knownDevices.push({ mac: d.mac ? d.mac.toLowerCase().replace(/-/g, ":") : null, ip: d.ip || null, name: d.name ? String(d.name).slice(0, 60) : null });
  }
  if (p.knownDevices != null && !Array.isArray(p.knownDevices)) errors.push(`"knownDevices" must be a list.`);
  for (const [i, a] of (Array.isArray(p.accepted) ? p.accepted : []).entries()) {
    if (!a || !/^PL-[A-Z0-9-]+$/.test(a.id || "")) { errors.push(`accepted[${i}] needs an "id" like "PL-FTP".`); continue; }
    if (!a.reason) { errors.push(`accepted[${i}] (${a.id}) needs a "reason".`); continue; }
    if (a.until && Number.isNaN(Date.parse(a.until))) { errors.push(`accepted[${i}] (${a.id}): "until" must be a date like 2027-06-30.`); continue; }
    out.accepted.push({ id: a.id, device: a.device || null, reason: String(a.reason).slice(0, 300), until: a.until || null, by: a.by ? String(a.by).slice(0, 120) : null });
  }
  if (p.accepted != null && !Array.isArray(p.accepted)) errors.push(`"accepted" must be a list.`);
  if (errors.length) throw new Error(`The policy file has ${errors.length === 1 ? "a problem" : `${errors.length} problems`}:\n- ${errors.join("\n- ")}`);
  return out;
}

export function loadPolicy(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new Error(`Couldn't read the policy file "${file}".`); }
  let json;
  try { json = JSON.parse(raw.replace(/^﻿/, "")); } catch (e) { throw new Error(`The policy file "${file}" isn't valid JSON: ${e.message}`); }
  return validatePolicy(json);
}

const sameDevice = (entry, d) => entry && d && ((entry.mac && d.mac && entry.mac === d.mac.toLowerCase()) || (entry.ip && entry.ip === d.ip));

export function knownName(policy, d) {
  return policy?.knownDevices?.find((k) => sameDevice(k, d))?.name || null;
}

// Marks accepted findings. An acceptance past its "until" date stops applying, and says so.
export function applyAccepted(findings, devices, policy, now = Date.now()) {
  for (const f of findings) {
    if (f.level === "all-good") continue;
    const d = f.device ? devices.find((x) => x.ip === f.device) : null;
    const a = policy?.accepted?.find((x) => x.id === f.id && (!x.device || x.device === f.device || (d?.mac && x.device.toLowerCase() === d.mac.toLowerCase())));
    if (!a) continue;
    if (a.until && Date.parse(a.until) + 86400000 < now) f.acceptanceExpired = { ...a };
    else f.accepted = { ...a };
  }
  return findings;
}

export const isOpen = (f) => !f.accepted && (f.level === "fix-soon" || f.level === "worth-fixing");

// Exit code for automation: 1 when an unaccepted finding is at or above the policy's "failOn" level.
export function failsPolicy(findings, failOn) {
  if (!failOn) return false;
  const limit = LEVELS.indexOf(failOn);
  return findings.some((f) => !f.accepted && LEVELS.indexOf(f.level) <= limit);
}
