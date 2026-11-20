#!/usr/bin/env node
// Porchlight: a security checkup for your home network.
//   porchlight            open the panel in your browser (http://localhost:7377)
//   porchlight --scan --this-is-my-network [--wifi "Name"]   run in the terminal and print the report
import { runCheckup } from "../src/scan.js";
import { startServer } from "../src/server.js";
import { LEVEL_LABEL } from "../src/findings.js";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

if (flag("--help") || flag("-h")) {
  console.log(`Porchlight ${process.env.npm_package_version || ""}
  porchlight                                         open the panel (http://localhost:7377)
  porchlight --scan --this-is-my-network [--wifi N]  terminal report
  porchlight --scan --this-is-my-network --json      machine-readable report

Porchlight only checks the network this computer is on. It looks; it never breaks in.`);
  process.exit(0);
}

if (flag("--scan")) {
  if (!flag("--this-is-my-network")) {
    console.error("Porchlight only checks your own network. If this is your home network, add --this-is-my-network.");
    process.exit(2);
  }
  const report = await runCheckup({ homeSsid: value("--wifi"), onProgress: (s) => !flag("--json") && console.error(`… ${s}`) });
  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nPorchlight checkup of ${report.network.cidr} (${report.devices.length} devices, ${report.durationSec}s)`);
    console.log(`\n${report.summary}\n`);
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
