// Runs a system command and always resolves: { ok, stdout, stderr }. Never throws, never uses a shell.
import { execFile } from "node:child_process";

export function run(cmd, args = [], timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

export const isWindows = process.platform === "win32";
export const isLinux = process.platform === "linux";
