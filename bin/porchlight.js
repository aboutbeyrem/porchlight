#!/usr/bin/env node
// Porchlight: a security checkup for your home network.
//   porchlight            open the panel in your browser (http://localhost:7377)
//   porchlight --scan --this-is-my-network [--wifi "Name"]   run in the terminal and print the report
import { runCheckup } from "../src/scan.js";
import { startServer } from "../src/server.js";
import { LEVEL_LABEL } from "../src/findings.js";
import { forgetHistory, dataDir } from "../src/history.js";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

if (flag("--help") || flag("-h")) {
  console.log(`Porchlight ${process.env.npm_package_version || ""}
  porchlight                                         open the panel (http://localhost:7377)
  porchlight --scan --this-is-my-network [--wifi N]  terminal report
  porchlight --scan --this-is-my-network --json      machine-readable report
  porchlight --scan ... --no-history                 don't remember devices between checkups
  porchlight --forget                                delete what Porchlight remembers

Porchlight only checks the network this computer is on. It looks; it never breaks in.`);
  process.exit(0);
}

if (flag("--forget")) {
  console.log(forgetHistory() ? `Deleted Porchlight's memory in ${dataDir()}.` : "Porchlight had nothing remembered.");
  process.exit(0);
}

if (flag("--scan")) {
  if (!flag("--this-is-my-network")) {
    console.error("Porchlight only checks your own network. If this is your home network, add --this-is-my-network.");
    process.exit(2);
  }
  const report = await runCheckup({ homeSsid: value("--wifi"), history: !flag("--no-history"), onProgress: (s) => !flag("--json") && console.error(`… ${s}`) });
  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nPorchlight checkup of ${report.network.cidr} (${report.devices.length} devices, ${report.durationSec}s)`);
    console.log(`\nScore: ${report.score.value}/100 (${report.score.label}). ${report.summary}`);
    if (report.changes?.firstRun) console.log(`Porchlight will remember these ${report.devices.length} devices (on this computer only) and tell you next time if a new one joins.`);
    console.log("");
    for (const f of report.findings) {
      console.log(`[${LEVEL_LABEL[f.level]}] ${f.title}${f.deviceName ? `  (${f.deviceName})` : ""}`);
      console.log(`  What we found: ${f.found}`);
      console.log(`  What it means: ${f.means}`);
      console.log(`  How likely it matters: ${f.likely}`);
      f.fix.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log("");
    }
  }
} else {
  startServer();
}
