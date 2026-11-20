// The catalog of every check: a stable ID (for reports, tickets and accepted-risk lists), the related CIS Controls v8
// safeguards, and public references. The CIS mapping is Porchlight's own reading of the safeguards, not a
// certification by the Center for Internet Security.

export const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3, info: 4, pass: 5 };
const fromLevel = { "fix-soon": "high", "worth-fixing": "medium", "good-to-know": "low", "all-good": "pass" };

export const CHECKS = [
  { id: "PL-TELNET", match: /^Old remote-login service \(Telnet\)/, cis: ["4.8", "3.10"], refs: ["CWE-319"], about: "Telnet sends logins in clear text and is the main way botnets take over cameras and routers." },
  { id: "PL-FTP", match: /^Old file-sharing service \(FTP\)/, cis: ["4.8", "3.10"], refs: ["CWE-319"], about: "FTP sends logins and files in clear text." },
  { id: "PL-SMB1", match: /^Old file-sharing protocol SMBv1/, cis: ["4.8"], refs: ["MS17-010", "CVE-2017-0144"], about: "SMB version 1 is accepted." },
  { id: "PL-SMB-SIGNING", match: /^File sharing doesn't require signing/, cis: ["4.1"], refs: ["MITRE ATT&CK T1557.001"], about: "SMB signing is not required, which allows relay attacks.", profile: "office" },
  { id: "PL-RDP-NLA", match: /^Remote Desktop doesn't require sign-in first/, cis: ["4.1"], refs: ["CVE-2019-0708"], about: "Remote Desktop accepts connections without Network Level Authentication." },
  { id: "PL-RDP-ON", match: /^Windows Remote Desktop is on/, cis: ["4.8"], refs: [], about: "Remote Desktop is enabled on another computer.", profile: "home" },
  { id: "PL-VNC", match: /^Remote screen control \(VNC\)/, cis: ["4.8"], refs: [], about: "VNC remote control is reachable." },
  { id: "PL-ADB", match: /^Android debugging is open/, cis: ["4.8"], refs: ["CWE-306"], about: "Android Debug Bridge is reachable over the network." },
  { id: "PL-DOCKER", match: /^Docker can be controlled/, cis: ["4.8", "4.1"], refs: ["CWE-306"], about: "The Docker API is exposed without TLS on port 2375." },
  { id: "PL-RTSP-OPEN", match: /^Camera video can be watched without a password/, cis: ["4.1", "3.3"], refs: ["CWE-306"], about: "An RTSP camera stream answers without authentication." },
  { id: "PL-RTSP-OK", match: /^Camera video asks for a password/, cis: [], refs: [], about: "An RTSP camera stream requires authentication." },
  { id: "PL-XMEYE", match: /^Remote-viewing service with a history/, cis: ["4.8", "7.4"], refs: [], about: "The XMEye/Xiongmai DVR service (port 34567) is reachable." },
  { id: "PL-MQTT", match: /^Smart-home messages are not encrypted/, cis: ["3.10"], refs: ["CWE-319"], about: "An MQTT broker without TLS is reachable." },
  { id: "PL-DEFAULT-PASSWORD", match: /^Make sure the .* has its own admin password/, cis: ["4.7"], refs: [], about: "A device with a settings page; factory passwords can't be ruled out without trying them, which Porchlight never does." },
  { id: "PL-TLS-OLD", match: /^Encrypted service still accepts old TLS/, cis: ["3.10"], refs: ["RFC 8996"], about: "TLS 1.0 or 1.1 is accepted." },
  { id: "PL-CERT-EXPIRED", match: /^Expired security certificate/, cis: ["3.10"], refs: [], about: "A TLS certificate has expired.", profile: "office" },
  { id: "PL-CERT-EXPIRING", match: /^Security certificate expires soon/, cis: ["3.10"], refs: [], about: "A TLS certificate expires within 30 days.", profile: "office" },
  { id: "PL-CERT-SELFSIGNED", match: /^Self-signed security certificate/, cis: ["3.10"], refs: [], about: "A TLS certificate is self-signed.", profile: "office" },
  { id: "PL-CERT-WEAKKEY", match: /^Weak certificate key/, cis: ["3.10"], refs: [], about: "A TLS certificate key is shorter than 2048 bits.", profile: "office" },
  { id: "PL-REDIS-NOAUTH", match: /^Database answers without a password \(Redis\)/, cis: ["3.3", "4.1"], refs: ["CWE-306"], about: "Redis answers PING without authentication." },
  { id: "PL-ELASTIC-NOAUTH", match: /^Search database answers without a password/, cis: ["3.3", "4.1"], refs: ["CWE-306"], about: "Elasticsearch answers without authentication." },
  { id: "PL-MEMCACHED", match: /^Cache server with no password/, cis: ["3.3", "4.8"], refs: ["CWE-306"], about: "Memcached is reachable." },
  { id: "PL-DB-REACHABLE", match: /^Database reachable from the whole network/, cis: ["12.2", "4.4"], refs: [], about: "A database port is reachable from the scanned network.", profile: "office" },
  { id: "PL-UPNP-MAPPING", match: /^A device opened a door to the internet/, cis: ["4.2", "12.2"], refs: [], about: "A device created a port forward through UPnP." },
  { id: "PL-UPNP-ON", match: /^Your router lets devices open doors/, cis: ["4.2"], refs: [], about: "UPnP port forwarding is enabled, with nothing forwarded." },
  { id: "PL-UPNP-OFF", match: /^Devices can't open doors to the internet/, cis: [], refs: [], about: "UPnP port forwarding is off." },
  { id: "PL-ROUTER-HTTP", match: /^Router settings page is not encrypted/, cis: ["12.6", "3.10"], refs: ["CWE-319"], about: "The router's admin page is only available over HTTP." },
  { id: "PL-WIFI-OPEN", match: /^Your Wi-Fi .* has no password/, cis: ["12.6"], refs: [], about: "A Wi-Fi network of yours is open." },
  { id: "PL-WIFI-WEP", match: /^Your Wi-Fi .* uses WEP/, cis: ["12.6"], refs: [], about: "A Wi-Fi network of yours uses WEP." },
  { id: "PL-WIFI-WPA", match: /^Your Wi-Fi .* uses old WPA/, cis: ["12.6"], refs: [], about: "A Wi-Fi network of yours uses WPA (version 1)." },
  { id: "PL-WIFI-TKIP", match: /^Your Wi-Fi .* TKIP/, cis: ["12.6"], refs: [], about: "A Wi-Fi network of yours uses WPA2 with TKIP." },
  { id: "PL-WIFI-OK", match: /^Your (Wi-Fi .*|\d+ Wi-Fi networks are) well protected/, cis: [], refs: [], about: "Your Wi-Fi networks use WPA2 or WPA3." },
  { id: "PL-WIFI-UNSEEN", match: /^We couldn't see/, cis: [], refs: [], about: "The named Wi-Fi network wasn't heard from this computer." },
  { id: "PL-WPS", match: /^WPS is on for/, cis: ["4.2", "12.6"], refs: ["CVE-2011-5053"], about: "An access point of yours announces WPS." },
  { id: "PL-WPS-OFF", match: /^WPS is off/, cis: [], refs: [], about: "Your access points don't announce WPS." },
  { id: "PL-EVIL-TWIN", match: /^A network with .* is using your Wi-Fi's name/, cis: [], refs: [], about: "An access point that isn't yours broadcasts your network name with weaker protection." },
  { id: "PL-SSID-DUPLICATE", match: /^Another access point uses your Wi-Fi's name/, cis: [], refs: [], about: "An access point that isn't tied to you broadcasts your network name." },
  { id: "PL-EVIL-TWIN-OK", match: /^No copies of your Wi-Fi nearby/, cis: [], refs: [], about: "No other access point broadcasts your network name." },
  { id: "PL-FIREWALL", match: /^This computer's firewall is off/, cis: ["4.5"], refs: [], about: "Windows Firewall is off for the active network." },
  { id: "PL-FIREWALL-OK", match: /^This computer's firewall is on/, cis: [], refs: [], about: "Windows Firewall is on for the active network." },
  { id: "PL-MONITOR-ON", match: /is in monitor mode$/, cis: [], refs: [], about: "A Wi-Fi adapter on this computer is in monitor mode.", severity: "info" },
  { id: "PL-MONITOR-CAPABLE", match: /can do monitor mode/, cis: [], refs: [], about: "A Wi-Fi adapter on this computer supports monitor mode.", severity: "info" },
  { id: "PL-NEW-DEVICE", match: /new devices? joined your network$/i, cis: ["1.1", "1.2"], refs: [], about: "A device appeared that previous checkups hadn't seen." },
  { id: "PL-UNKNOWN-DEVICE", match: /not on your list of known devices$/, cis: ["1.1", "1.2"], refs: [], about: "A device isn't in the policy's list of known devices." },
  { id: "PL-FIXED", match: /fixed since your last checkup$/i, cis: [], refs: [], about: "Problems from the previous checkup that are gone now." },
];

export function checkFor(title) {
  return CHECKS.find((c) => c.match.test(title)) || null;
}

const DOOR_IDS = { "PL-TELNET": [23, 2323], "PL-FTP": [21], "PL-VNC": [5900], "PL-ADB": [5555], "PL-DOCKER": [2375], "PL-XMEYE": [34567], "PL-MQTT": [1883], "PL-MEMCACHED": [11211], "PL-REDIS-NOAUTH": [6379], "PL-ELASTIC-NOAUTH": [9200], "PL-RDP-NLA": [3389], "PL-RDP-ON": [3389], "PL-SMB1": [445], "PL-SMB-SIGNING": [445] };

// Facts for IT staff: exactly what was observed.
function technical(f, d) {
  if (!d) return null;
  const bits = [];
  const doors = (DOOR_IDS[f.id] || []).filter((p) => d.ports?.includes(p));
  if (doors.length) bits.push(`${d.ip} TCP/${doors.join(", TCP/")} open`);
  if (/^PL-SMB/.test(f.id) && d.smb) bits.push(`SMB2 dialect ${d.smb.dialect || "n/a"}, signing ${d.smb.signingRequired ? "required" : d.smb.signingEnabled ? "enabled, not required" : "off"}, SMBv1 ${d.smb.smb1 ? "accepted" : "refused"}`);
  if (f.id === "PL-RDP-NLA" && d.rdp) bits.push(`RDP negotiation accepted ${d.rdp.protocol === "rdp" ? "standard RDP security" : "TLS without CredSSP"}`);
  if (f.id === "PL-RTSP-OPEN" && d.rtsp) bits.push(`RTSP DESCRIBE rtsp://${d.ip}:${d.rtsp.port}${d.rtsp.path} → 200 OK without credentials`);
  if (f.id === "PL-FTP" && d.ftp) bits.push(`banner: ${d.ftp}`);
  if (/^PL-(TLS|CERT)/.test(f.id) && d.tls) {
    for (const [p, t] of Object.entries(d.tls)) if (t) bits.push(`TCP/${p}: ${t.protocol}${t.oldVersions?.length ? `, also ${t.oldVersions.join(", ")}` : ""}${t.cert ? `; cert CN=${t.cert.subject || "?"}, issuer ${t.cert.issuer || "?"}, expires ${t.cert.expires.slice(0, 10)}, ${t.cert.bits || "?"} bits` : ""}`);
  }
  if (f.id === "PL-ELASTIC-NOAUTH" && d.elastic) bits.push(`GET http://${d.ip}:9200/ → 200 with cluster info${d.elastic.version ? `, version ${d.elastic.version}` : ""}`);
  if (f.id === "PL-REDIS-NOAUTH") bits.push("PING → +PONG without AUTH");
  if (f.id === "PL-DB-REACHABLE" && d.mysql?.version) bits.push(`MySQL greeting: ${d.mysql.version}`);
  if (d.mac && !d.self) bits.push(`MAC ${d.mac}${d.vendor ? ` (${d.vendor})` : ""}`);
  return bits.length ? bits.join("; ") : null;
}

// Adds id, severity, CIS safeguards, references and technical details to every finding.
export function annotate(findings, devices = []) {
  for (const f of findings) {
    const c = checkFor(f.title);
    f.id = c?.id || "PL-OTHER";
    f.severity = f.exposed ? "critical" : c?.severity && f.level !== "all-good" ? c.severity : fromLevel[f.level];
    f.cis = c?.cis || [];
    f.refs = c?.refs || [];
    const d = f.device ? devices.find((x) => x.ip === f.device) : null;
    f.technical = f.technical || technical(f, d);
  }
  return findings;
}

// Markdown list of every check, for the docs.
export function catalogMarkdown() {
  const rows = CHECKS.map((c) => `| \`${c.id}\` | ${c.about} | ${c.cis.map((s) => `CIS ${s}`).join(", ") || "—"} | ${c.refs.join(", ") || "—"} | ${c.profile || "both"} |`);
  return ["| ID | What it means | CIS Controls v8 | References | Profile |", "|---|---|---|---|---|", ...rows].join("\n");
}
