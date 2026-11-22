// Renders the installer artwork (app/installer/*.html) to the 24-bit BMP files the Windows installer needs.
// Uses Microsoft Edge in headless mode for the drawing and Windows' own imaging for the BMP conversion.
// Run: node scripts/make-installer-art.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve("app/installer");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!edge) throw new Error("Microsoft Edge not found");

for (const [name, w, h] of [["sidebar", 164, 314], ["header", 150, 57]]) {
  const png = path.join(dir, `${name}.png`);
  execFileSync(edge, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`, `--screenshot=${png}`, pathToFileURL(path.join(dir, `${name}.html`)).href], { stdio: "ignore" });
  const bmp = path.join(dir, `${name}.bmp`);
  // Copy onto a 24-bit canvas: the installer can't use 32-bit bitmaps.
  const ps = `Add-Type -AssemblyName System.Drawing; $s=[System.Drawing.Image]::FromFile('${png}'); $b=New-Object System.Drawing.Bitmap ${w},${h},([System.Drawing.Imaging.PixelFormat]::Format24bppRgb); $g=[System.Drawing.Graphics]::FromImage($b); $g.DrawImage($s,0,0,${w},${h}); $g.Dispose(); $s.Dispose(); $b.Save('${bmp}',[System.Drawing.Imaging.ImageFormat]::Bmp); $b.Dispose()`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  fs.unlinkSync(png);
  console.log(`${name}.bmp ${w}x${h}`);
}
