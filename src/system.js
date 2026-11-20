// Facts about this computer itself. Read-only.
import { run, isWindows } from "./exec.js";

// `netsh advfirewall show currentprofile state` / `allprofiles state`, English and French.
export function parseFirewall(text) {
  const out = {};
  let profile = null;
  for (const line of text.split(/\r?\n/)) {
    const p = line.match(/^(Domain|Private|Public|Domaine|Priv[ée]|Public)\w*\s+(Profile|Profil)/i) || line.match(/^(?:Param[eè]tres du )?profil (de domaine|priv[ée]|public)/i);
    if (p) {
      const name = p[1].toLowerCase();
      profile = /dom/.test(name) ? "domain" : /priv/.test(name) ? "private" : "public";
      continue;
    }
    const s = line.match(/^(State|[ÉE]tat)\s+(\S+)/i);
    if (s && profile) out[profile] = /^(ON|ACTIF|ACTIVE)$/i.test(s[2]);
  }
  return out;
}

// Which firewall profile the active network uses ("Private Profile Settings:" in `show currentprofile`).
export async function firewallStatus() {
  if (!isWindows) return null;
  const current = parseFirewall((await run("netsh", ["advfirewall", "show", "currentprofile", "state"])).stdout);
  const names = Object.keys(current);
  if (!names.length) return null;
  return { profiles: names, on: names.every((n) => current[n]) };
}
