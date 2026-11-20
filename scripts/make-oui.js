// Builds data/oui.txt from the IEEE MA-L registry (https://standards-oui.ieee.org/oui/oui.csv):
// one line per manufacturer prefix, "286FB9<TAB>Nokia", with short, readable brand names.
// Run: node scripts/make-oui.js path/to/oui.csv
import fs from "node:fs";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/make-oui.js oui.csv"); process.exit(2); }

// Minimal CSV reader (quoted fields, commas inside quotes).
function* rows(text) {
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      yield row; row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

// Well-known brands, so people see "TP-Link" rather than "TP-LINK TECHNOLOGIES CO.,LTD.".
const BRANDS = [
  [/^apple/i, "Apple"], [/^samsung/i, "Samsung"], [/^huawei|^honor device/i, "Huawei"], [/^xiaomi|^beijing xiaomi/i, "Xiaomi"],
  [/^tp-?link/i, "TP-Link"], [/^google/i, "Google"], [/^amazon/i, "Amazon"], [/^intel/i, "Intel"], [/^microsoft/i, "Microsoft"],
  [/^sony/i, "Sony"], [/^lg electronics|^lg innotek/i, "LG"], [/^oppo|^guangdong oppo/i, "OPPO"], [/^vivo/i, "vivo"],
  [/^oneplus/i, "OnePlus"], [/^realme/i, "realme"], [/^motorola/i, "Motorola"], [/^nokia/i, "Nokia"], [/^lenovo/i, "Lenovo"],
  [/^dell/i, "Dell"], [/^hewlett|^hp inc|^hp /i, "HP"], [/^asustek|^asus/i, "ASUS"], [/^acer/i, "Acer"], [/^msi|^micro-star/i, "MSI"],
  [/^hon hai|^foxconn/i, "Foxconn"], [/^liteon|^lite-on/i, "Lite-On"], [/^azurewave/i, "AzureWave"], [/^realtek/i, "Realtek"],
  [/^mediatek/i, "MediaTek"], [/^qualcomm/i, "Qualcomm"], [/^broadcom/i, "Broadcom"], [/^espressif/i, "Espressif"],
  [/^tuya/i, "Tuya"], [/^hangzhou hikvision|^hikvision/i, "Hikvision"], [/^zhejiang dahua|^dahua/i, "Dahua"], [/^ezviz/i, "EZVIZ"],
  [/^reolink/i, "Reolink"], [/^ubiquiti/i, "Ubiquiti"], [/^netgear/i, "Netgear"], [/^d-link/i, "D-Link"], [/^zyxel/i, "Zyxel"],
  [/^sagemcom/i, "Sagemcom"], [/^arcadyan/i, "Arcadyan"], [/^technicolor/i, "Technicolor"], [/^cisco/i, "Cisco"],
  [/^mikrotik|^routerboard/i, "MikroTik"], [/^tenda|^shenzhen tenda/i, "Tenda"], [/^shenzhen pix-?link|pix-?link/i, "PIX-LINK"],
  [/^alfa/i, "ALFA"], [/^raspberry/i, "Raspberry Pi"], [/^nintendo/i, "Nintendo"], [/^roku/i, "Roku"], [/^sonos/i, "Sonos"],
  [/^canon/i, "Canon"], [/^seiko epson|^epson/i, "Epson"], [/^brother/i, "Brother"], [/^xerox/i, "Xerox"],
  [/^tcl/i, "TCL"], [/^hisense/i, "Hisense"], [/^philips|^signify/i, "Philips"], [/^bose/i, "Bose"], [/^garmin/i, "Garmin"],
  [/^fitbit/i, "Fitbit"], [/^synology/i, "Synology"], [/^qnap/i, "QNAP"], [/^vmware/i, "VMware"], [/^oracle/i, "Oracle"],
  [/^econet/i, "EcoNet"], [/^shenzhen bilian/i, "Bilian"], [/^murata/i, "Murata"], [/^texas instruments/i, "Texas Instruments"],
];

const SUFFIX = /[,.]?\s+(co\.?,?\s*ltd\.?|company,? limited|co\.|corp(oration)?\.?|inc\.?|incorporated|ltd\.?|limited|llc|gmbh|s\.?a\.?|b\.?v\.?|ag|plc|pte\.?|pty\.?|technolog(y|ies)|electronics?|communications?|international|industrial|group|holdings?)\b.*$/i;
function short(name) {
  const n = name.replace(/\s+/g, " ").trim();
  for (const [re, brand] of BRANDS) if (re.test(n)) return brand;
  let s = n.replace(/^(shenzhen|guangdong|hangzhou|beijing|shanghai|zhejiang|jiangsu|dongguan|xiamen|suzhou|wuhan|chengdu|qingdao)\s+/i, "");
  for (let i = 0; i < 3; i++) s = s.replace(SUFFIX, "").trim();
  s = s.replace(/[,.\s]+$/, "");
  if (s === s.toUpperCase() && s.length > 4) s = s.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
  return (s || n).slice(0, 32);
}

const text = fs.readFileSync(src, "utf8");
const out = new Map();
let first = true;
for (const r of rows(text)) {
  if (first) { first = false; continue; }
  const [registry, assignment, org] = r;
  if (registry !== "MA-L" || !/^[0-9A-F]{6}$/i.test(assignment || "") || !org || /^private$/i.test(org.trim())) continue;
  out.set(assignment.toUpperCase(), short(org));
}
const lines = [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}\t${v}`);
fs.mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../data/oui.txt", import.meta.url), `# Manufacturer prefixes from the IEEE MA-L registry (standards-oui.ieee.org), names shortened.\n${lines.join("\n")}\n`);
console.log(`data/oui.txt: ${lines.length} prefixes`);
