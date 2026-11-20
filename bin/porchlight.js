#!/usr/bin/env node
// Porchlight: a security checkup for home and office networks. It looks; it never breaks in.
// Run with --help for every option.
import fs from "node:fs";
import path from "node:path";
import { runCheckup } from "../src/scan.js";
import { startServer } from "../src/server.js";
import { LEVEL_LABEL } from "../src/findings.js";
import { forgetHistory, dataDir } from "../src/history.js";
import { loadPolicy, EXAMPLE } from "../src/policy.js";
import { catalogMarkdown } from "../src/catalog.js";
import { render, VERSION } from "../src/report.js";
import { parseRanges } from "../src/ranges.js";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const values = (f) => args.flatMap((a, i) => (a === f && args[i + 1] ? [args[i + 1]] : []));
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };

const HELP = `Porchlight ${VERSION}: a security checkup for home and office networks. It looks; it never breaks in.

  porchlight                                   open the panel in your browser (http://localhost:7377)
  porchlight --scan --this-is-my-network       check the network this computer is on, report in the terminal

Options for --scan:
  --wifi "Name"                your Wi-Fi's name, to check its protection and WPS
  --profile home|office        office: databases, SMB signing, TLS and certificates, more ports (default: home)
  --policy file.json           office policy: ranges, known devices, accepted risks, failOn (see --init-policy)
  --range 10.0.5.0/24          check a private range other than this computer's network (repeatable)
  --authorized-by "Name"       required with --range: who authorised the check (recorded in the report)
  --out report.html            write a report: .html, .csv, .md or .json (repeatable)
  --json                       print the full report as JSON instead of text
  --fail-on worth-fixing       exit with code 1 if an unaccepted finding is at this level or worse
  --no-history                 don't remember devices between checkups

Other commands:
  porchlight --init-policy porchlight-policy.json   write an example policy file
  porchlight --catalog                              list every check with its ID and CIS Controls mapping
  porchlight --forget                               delete what Porchlight remembers (${dataDir()})

Exit codes: 0 done, 1 findings at or above --fail-on, 2 wrong options, 3 the checkup couldn't run.
Porchlight only checks private networks you're allowed to check. It never logs in, never tries passwords,
never floods or disconnects anything, and sends nothing outside the network it checks.`;

if (flag("--help") || flag("-h")) { console.log(HELP); process.exit(0); }
if (flag("--version")) { console.log(VERSION); process.exit(0); }
if (flag("--catalog")) { console.log(catalogMarkdown()); process.exit(0); }
if (flag("--forget")) {
  console.log(forgetHistory() ? `Deleted Porchlight's memory in ${dataDir()}.` : "Porchlight had nothing remembered.");
  process.exit(0);
}
if (flag("--init-policy")) {
  const file = value("--init-policy") || "porchlight-policy.json";
  if (fs.existsSync(file)) fail(`"${file}" already exists. Pick another name or delete it first.`);
  fs.writeFileSync(file, JSON.stringify(EXAMPLE, null, 2) + "\n");
  console.log(`Wrote an example policy to ${file}. Edit it, then run: porchlight --scan --policy ${file}`);
  process.exit(0);
}

let policy = null;
if (value("--policy")) {
  try { policy = loadPolicy(value("--policy")); } catch (e) { fail(e.message); }
}

if (!flag("--scan")) {
  startServer(undefined, { policy });
} else {
  const ranges = values("--range");
  const authorizedBy = value("--authorized-by") || policy?.authorizedBy || null;
  const profile = value("--profile") || policy?.profile || "home";
  if (!["home", "office"].includes(profile)) fail(`--profile must be "home" or "office".`);
  const failOn = value("--fail-on") || policy?.failOn || null;
  if (failOn && !["fix-soon", "worth-fixing", "good-to-know"].includes(failOn)) fail(`--fail-on must be fix-soon, worth-fixing or good-to-know.`);
  const outs = values("--out");
  for (const o of outs) if (![".html", ".htm", ".csv", ".md", ".json"].includes(path.extname(o).toLowerCase())) fail(`--out "${o}": use a .html, .csv, .md or .json file name.`);

  if (ranges.length) {
    try { parseRanges(ranges); } catch (e) { fail(e.message); }
  }
  const usesRanges = ranges.length || policy?.ranges?.length;
  if (usesRanges && !authorizedBy) fail("Checking other ranges needs --authorized-by \"Name of the person who authorised it\".");
  if (!usesRanges && !flag("--this-is-my-network") && !policy) {
    fail("Porchlight only checks networks you're allowed to check. If this is your network, add --this-is-my-network.");
  }

  let report;
  try {
    report = await runCheckup({
      homeSsid: value("--wifi"),
      history: !flag("--no-history"),
      profile,
      policy: policy ? { ...policy, failOn } : failOn ? { failOn, accepted: [], knownDevices: [] } : null,
      ranges: ranges.length ? ranges : null,
      authorizedBy,
      onProgress: (s) => !flag("--json") && console.error(`… ${s}`),
    });
  } catch (e) {
    fail(`The checkup couldn't run: ${e.message}`, 3);
  }

  for (const o of outs) {
    const ext = { ".htm": "html", ".html": "html", ".csv": "csv", ".md": "md", ".json": "json" }[path.extname(o).toLowerCase()];
    fs.writeFileSync(o, render(report, ext));
    if (!flag("--json")) console.error(`Wrote ${o}`);
  }

  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nPorchlight checkup of ${report.scope.join(", ")} (${report.devices.length} devices, ${report.durationSec}s, ${report.profile} profile)`);
    if (report.authorization) console.log(`Authorised by: ${report.authorization.by}`);
    console.log(`\nScore: ${report.score.value}/100 (${report.score.label}). ${report.summary}`);
    if (report.changes?.firstRun) console.log(`Porchlight will remember these ${report.devices.length} devices (on this computer only) and tell you next time if a new one joins.`);
    console.log("");
    for (const f of report.findings) {
      console.log(`[${LEVEL_LABEL[f.level]}${f.accepted ? ", accepted" : ""}] ${f.title}${f.deviceName ? `  (${f.deviceName})` : ""}  ${f.id}`);
      console.log(`  What we found: ${f.found}`);
      console.log(`  What it means: ${f.means}`);
      console.log(`  How likely it matters: ${f.likely}`);
      f.fix.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      if (f.technical) console.log(`  Technical: ${f.technical}`);
      if (f.accepted) console.log(`  Accepted: ${f.accepted.reason}${f.accepted.until ? ` (until ${f.accepted.until})` : ""}`);
      console.log("");
    }
  }
  process.exit(report.failed ? 1 : 0);
}
