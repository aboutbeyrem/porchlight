//! The guard: one "check" looks at the home network and Wi-Fi, compares with what it saw before, and decides what's
//! worth telling you. It remembers devices, alerts and settings in a small file on this computer only.

use crate::checks::{self, DeepResult};
use crate::names::{self, Mapping, Upnp};
use crate::net::{self, mac_str, Network};
use crate::wifi::{self, AccessPoint, SavedNetwork, Survey};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::Ipv4Addr;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Device {
    pub key: String,
    pub ip: String,
    pub mac: String,
    pub vendor: Option<String>,
    pub detected_name: Option<String>,
    pub custom_name: Option<String>,
    pub upnp_name: Option<String>,
    /// The name it advertises for a service ("Living Room TV", "Sara's iPhone").
    pub service_name: Option<String>,
    /// The name it gave the router when it joined (from the router's DNS).
    pub router_name: Option<String>,
    pub web_title: Option<String>,
    pub kind: String,
    pub name: String,
    pub first_seen: u64,
    pub last_seen: u64,
    pub online: bool,
    pub is_router: bool,
    pub is_self: bool,
    pub private_mac: bool,
    pub behind_repeater: bool,
    pub broadcasts: Vec<String>,
    pub names_checked: u64,
    /// Which set of name sources was last asked; a newer Porchlight asks again straight away.
    pub naming: u32,
    /// The user's answer to "Is this yours?": Some(true) ours, Some(false) not recognised, None not asked yet.
    pub owner: Option<bool>,
    /// Ping reply TTL, asked only of devices that announce no name: a hint at what they are.
    pub ttl: Option<u8>,
    pub deep: Option<DeepResult>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Finding {
    pub id: String,
    pub level: String,
    pub title: String,
    pub found: String,
    pub means: String,
    pub likely: String,
    pub fix: Vec<String>,
    pub device: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Alert {
    pub id: u64,
    pub at: u64,
    pub level: String,
    pub title: String,
    pub body: String,
    pub device: Option<String>,
    pub read: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub consented: bool,
    pub interval_min: u32,
    pub notify: bool,
    pub home_ssid: Option<String>,
    pub paused: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Settings { consented: false, interval_min: 10, notify: true, home_ssid: None, paused: false }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Home {
    pub cidr: String,
    pub gateway: String,
    pub router_mac: Option<String>,
    /// The DNS servers this computer used at the first look.
    pub dns: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WifiNet {
    pub ssid: String,
    pub protection: String,
    pub wps: bool,
    pub pmf: String,
    pub source: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WifiView {
    pub home_ssid: Option<String>,
    pub connected: Option<String>,
    pub adapters: Vec<String>,
    pub yours: Vec<WifiNet>,
    pub copies: Vec<WifiNet>,
    pub visible: Vec<String>,
    pub saved_open_auto: Vec<SavedNetwork>,
    pub saved_hidden: Vec<SavedNetwork>,
    pub saved_count: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub version: u32,
    pub settings: Settings,
    pub home: Option<Home>,
    pub network: Option<Network>,
    pub on_home: bool,
    pub devices: BTreeMap<String, Device>,
    pub alerts: Vec<Alert>,
    pub findings: Vec<Finding>,
    pub wifi: WifiView,
    pub upnp_on: Option<bool>,
    pub mappings: Vec<Mapping>,
    pub baseline_done: bool,
    /// When Porchlight first finished looking: devices seen after this are "new".
    pub baseline_at: u64,
    pub last_check: u64,
    pub last_full: u64,
    pub status: String,
    pub score: u32,
    pub next_alert: u64,
    pub notified: Vec<String>,
    /// The last DNS test result (it only runs on full checkups).
    pub dns_invents: Option<bool>,
    /// Findings the user said are fine ("ID|device"): kept out of the score, the to-do list and alerts.
    pub accepted: Vec<String>,
}

impl State {
    pub fn load(path: &Path) -> State {
        std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| State { version: 1, ..Default::default() })
    }
    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, s).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }
    fn alert(&mut self, level: &str, title: String, body: String, device: Option<String>) -> Alert {
        self.next_alert += 1;
        let a = Alert { id: self.next_alert, at: now(), level: level.into(), title, body, device, read: false };
        self.alerts.insert(0, a.clone());
        self.alerts.truncate(200);
        a
    }
    /// Recomputes the score after the user accepts or un-accepts a finding.
    pub fn refresh_score(&mut self) {
        self.score = score_with(&self.findings, &self.accepted);
    }
    /// True the first time a given situation is seen, so the same thing never notifies twice.
    fn first_time(&mut self, key: String) -> bool {
        if self.notified.contains(&key) {
            return false;
        }
        self.notified.push(key);
        if self.notified.len() > 500 {
            self.notified.drain(..100);
        }
        true
    }
}

// ---------- device names and kinds ----------
/// This computer seen through another of its connections (Wi-Fi and Ethernet both on, for example): it answers
/// with this computer's own name.
fn is_this_pc(d: &Device) -> bool {
    let Ok(me) = std::env::var("COMPUTERNAME") else { return false };
    [&d.detected_name, &d.router_name].into_iter().flatten().any(|n| n.eq_ignore_ascii_case(&me))
}

fn kind_of(d: &Device) -> String {
    if d.is_router {
        return "router".into();
    }
    if d.is_self {
        return "this computer".into();
    }
    if is_this_pc(d) {
        return "this computer (another connection)".into();
    }
    let text = [&d.upnp_name, &d.service_name, &d.detected_name, &d.router_name, &d.web_title, &d.vendor].iter().filter_map(|n| n.as_deref()).collect::<Vec<_>>().join(" ").to_lowercase();
    let ports = d.deep.as_ref().map(|x| x.ports.clone()).unwrap_or_default();
    let has = |w: &[&str]| w.iter().any(|x| text.contains(x));
    if has(&["camera", "ipc", "nvr", "dvr", "hikvision", "dahua", "reolink", "ezviz", "imou", "netcam"]) || ports.iter().any(|p| [554, 8554, 34567, 37777].contains(p)) {
        return "camera".into();
    }
    if !d.broadcasts.is_empty() || has(&["pix-link", "repeater", "extender", "mesh", "access point"]) {
        return "Wi-Fi extender".into();
    }
    if has(&["tv", "bravia", "roku", "chromecast", "fire tv", "android tv", "webos", "tizen"]) {
        return "TV or streaming device".into();
    }
    if has(&["printer", "epson", "canon", "brother", "laserjet", "deskjet"]) {
        return "printer".into();
    }
    if has(&["iphone", "ipad", "android", "galaxy", "redmi", "pixel", "phone"]) {
        return "phone or tablet".into();
    }
    if has(&["espressif", "tuya", "shelly", "sonoff", "philips"]) {
        return "smart-home device".into();
    }
    if has(&["apple"]) {
        return "Apple phone, tablet or computer".into();
    }
    if has(&["desktop-", "laptop-", "raspberry", "-pc", "pc-", "macbook", "imac", "thinkpad", "notebook"]) || ports.contains(&3389) || ports.contains(&445) {
        return "computer".into();
    }
    // Nothing announced: how it answers a ping is the last hint.
    match d.ttl {
        Some(t) if t > 64 && t <= 128 => return "Windows computer".into(),
        Some(t) if t > 32 && t <= 64 => return "phone, tablet or Mac".into(),
        _ => {}
    }
    // Only now, when nothing says what it is: the extender hides its maker, so this is all we know.
    if d.behind_repeater {
        return "device on your extender".into();
    }
    if d.private_mac {
        return "phone, tablet or laptop".into();
    }
    "device".into()
}

fn name_of(d: &Device) -> String {
    if let Some(n) = d.custom_name.as_ref().filter(|n| !n.trim().is_empty()) {
        return n.clone();
    }
    if d.is_self {
        return "This computer".into();
    }
    if d.is_router {
        return d.upnp_name.as_ref().map(|n| format!("Your router ({n})")).unwrap_or_else(|| "Your router".into());
    }
    if let Some(n) = own_name(d) {
        return n.to_string();
    }
    let kind = &d.kind;
    match &d.vendor {
        Some(v) if kind == "device" => format!("{v} device"),
        Some(v) if kind.to_lowercase().contains(&v.to_lowercase()) => cap(kind),
        Some(v) => format!("{v} {kind}"),
        None => cap(kind),
    }
}
fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Bumped when Porchlight learns a new way to find names (2: router DNS and service names; 3: ping hint).
const NAMING: u32 = 3;

/// The name a device announces about itself, best source first (not counting a name the user gave it).
fn own_name(d: &Device) -> Option<&str> {
    [&d.upnp_name, &d.service_name, &d.detected_name, &d.web_title, &d.router_name].into_iter().find_map(|n| n.as_deref())
}

/// Asks a device (and the router) for its name: every day, or every hour while it still has none, because phones
/// that are asleep don't answer.
fn refresh_names(d: &mut Device, upnp: &HashMap<Ipv4Addr, Upnp>, router: Ipv4Addr) {
    let Ok(ip) = d.ip.parse::<Ipv4Addr>() else { return };
    if let Some(u) = upnp.get(&ip) {
        d.upnp_name = u.friendly_name.clone().or(d.upnp_name.take());
    }
    if d.is_self {
        return;
    }
    let t = now();
    let retry = if own_name(d).is_some() { 24 * 3600 } else { 3600 };
    if d.names_checked == 0 || d.naming < NAMING || d.names_checked + retry < t {
        d.service_name = names::service_name(ip).or(d.service_name.take());
        d.detected_name = names::mdns_name(ip).or_else(|| names::netbios_name(ip)).or(d.detected_name.take());
        if !d.is_router {
            d.router_name = names::router_name(ip, router).or(d.router_name.take());
        }
        d.web_title = names::web_title(ip).or(d.web_title.take());
        if own_name(d).is_none() && !d.is_router {
            d.ttl = names::ping_ttl(ip).or(d.ttl);
        }
        d.names_checked = t;
        d.naming = NAMING;
    }
}

/// Two devices with the same name get the end of their address added, so they can be told apart.
pub fn disambiguate(devices: &mut BTreeMap<String, Device>) {
    let mut count: HashMap<String, usize> = HashMap::new();
    for d in devices.values().filter(|d| d.online && d.custom_name.is_none()) {
        *count.entry(d.name.to_lowercase()).or_default() += 1;
    }
    for d in devices.values_mut().filter(|d| d.online && d.custom_name.is_none()) {
        if count.get(&d.name.to_lowercase()).copied().unwrap_or(0) > 1 {
            if let Some(last) = d.ip.rsplit('.').next().filter(|l| !l.is_empty()) {
                d.name = format!("{} (.{last})", d.name);
            }
        }
    }
}

// ---------- Wi-Fi: which networks are yours, and copies of your name ----------
fn mac_bytes(s: &str) -> Vec<u8> {
    s.split(':').filter_map(|h| u8::from_str_radix(h, 16).ok()).collect()
}
/// A device's network MAC and its Wi-Fi radio MAC usually differ only in the first byte.
fn same_hardware(lan: &str, bssid: &str) -> bool {
    let (a, b) = (mac_bytes(lan), mac_bytes(bssid));
    a.len() == 6 && b.len() == 6 && a[2..] == b[2..]
}
/// Two networks from the same router have nearly identical radio MACs.
fn same_router(x: &str, y: &str) -> bool {
    let (a, b) = (mac_bytes(x), mac_bytes(y));
    a.len() == 6 && b.len() == 6 && x != y && a[1..].iter().zip(&b[1..]).filter(|(p, q)| p == q).count() >= 4
}
fn norm(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && !matches!(c, '\u{200b}'..='\u{200d}' | '\u{feff}')).collect::<String>().to_lowercase()
}
fn pmf_text(ap: &AccessPoint) -> String {
    if ap.security.pmf_required { "required" } else if ap.security.pmf_capable { "on" } else { "off" }.into()
}
fn net_view(ap: &AccessPoint, source: &str) -> WifiNet {
    WifiNet { ssid: ap.ssid.clone(), protection: wifi::protection(&ap.security).into(), wps: ap.wps.is_some(), pmf: pmf_text(ap), source: source.into() }
}

fn wifi_view(survey: &Survey, home: Option<&str>, devices: &BTreeMap<String, Device>) -> (WifiView, Vec<AccessPoint>, Vec<AccessPoint>) {
    let mut v = WifiView { adapters: survey.adapters.clone(), connected: survey.connected.as_ref().map(|c| c.ssid.clone()), saved_count: survey.saved.len(), ..Default::default() };
    v.saved_open_auto = survey.saved.iter().filter(|s| s.open && s.auto_connect).cloned().collect();
    v.saved_hidden = survey.saved.iter().filter(|s| s.hidden).cloned().collect();
    let mut names: Vec<String> = survey.aps.iter().map(|a| a.ssid.clone()).filter(|s| !s.is_empty()).collect();
    names.sort();
    names.dedup();
    v.visible = names;
    let home = survey.connected.as_ref().map(|c| c.ssid.clone()).or(home.map(String::from));
    v.home_ssid = home.clone();
    let Some(home) = home else { return (v, vec![], vec![]) };
    let lan_macs: Vec<&str> = devices.values().filter(|d| !d.is_self && !d.behind_repeater).map(|d| d.mac.as_str()).collect();

    // Group access points using your name by hardware; the real group is the connected one, one that belongs to a
    // device on your network, or else the best-protected one. A copy never gets to vouch for itself.
    let same: Vec<&AccessPoint> = survey.aps.iter().filter(|a| norm(&a.ssid) == norm(&home)).collect();
    let mut clusters: Vec<Vec<&AccessPoint>> = Vec::new();
    for ap in same {
        if let Some(c) = clusters.iter_mut().find(|c| c.iter().any(|x| x.bssid == ap.bssid || same_router(&x.bssid, &ap.bssid))) {
            c.push(ap);
        } else {
            clusters.push(vec![ap]);
        }
    }
    let connected_bssid = survey.connected.as_ref().map(|c| c.bssid.clone()).unwrap_or_default();
    let tied = |c: &Vec<&AccessPoint>| c.iter().any(|a| a.bssid == connected_bssid || lan_macs.iter().any(|m| same_hardware(m, &a.bssid)));
    let mut real: Vec<usize> = (0..clusters.len()).filter(|i| tied(&clusters[*i])).collect();
    if !clusters.iter().any(|c| c.iter().any(|a| a.bssid == connected_bssid)) {
        let best = (0..clusters.len())
            .filter(|i| !real.contains(i) && clusters[*i].iter().any(|a| a.ssid == home))
            .max_by_key(|i| clusters[*i].iter().map(|a| wifi::strength(wifi::protection(&a.security))).max().unwrap_or(-1));
        real.extend(best);
    }
    let real_aps: Vec<AccessPoint> = real.iter().flat_map(|i| clusters[*i].iter().map(|a| (*a).clone())).collect();
    let copies: Vec<AccessPoint> = (0..clusters.len()).filter(|i| !real.contains(i)).map(|i| clusters[i][0].clone()).collect();
    if let Some(ap) = real_aps.first() {
        v.yours.push(net_view(ap, "home"));
    }
    // Your other networks: a second name from the same router, or one broadcast by a device on your network.
    let mut seen: HashSet<String> = HashSet::from([home.clone()]);
    for ap in &survey.aps {
        if ap.ssid.is_empty() || seen.contains(&ap.ssid) {
            continue;
        }
        let source = if real_aps.iter().any(|r| same_router(&r.bssid, &ap.bssid)) {
            Some("second network from your router")
        } else if lan_macs.iter().any(|m| same_hardware(m, &ap.bssid)) {
            Some("your extender")
        } else {
            None
        };
        if let Some(src) = source {
            seen.insert(ap.ssid.clone());
            v.yours.push(net_view(ap, src));
        }
    }
    v.copies = copies.iter().map(|a| net_view(a, "copy")).collect();
    (v, real_aps, copies)
}

// ---------- findings, in plain words ----------
#[allow(clippy::too_many_arguments)]
fn f(id: &str, level: &str, device: Option<&Device>, title: String, found: String, means: &str, likely: &str, fix: &[&str]) -> Finding {
    Finding { id: id.into(), level: level.into(), title, found, means: means.into(), likely: likely.into(), fix: fix.iter().map(|s| s.to_string()).collect(), device: device.map(|d| d.key.clone()) }
}

fn device_findings(d: &Device, mappings: &[Mapping], out: &mut Vec<Finding>) {
    let Some(deep) = &d.deep else { return };
    let n = format!("{} ({})", d.name, d.ip);
    let has = |p: u16| deep.ports.contains(&p);
    let forwarded = |p: u16| mappings.iter().any(|m| m.internal_client == d.ip && m.internal_port == p);
    if has(23) || has(2323) {
        let p = if has(23) { 23 } else { 2323 };
        out.push(f("PL-TELNET", "fix-soon", Some(d), "Old remote-login service (Telnet) is on".into(), format!("{n} accepts Telnet, an old way to log into a device remotely."),
            "Telnet sends passwords as readable text, and it's the main door automated attacks use to take over cameras and routers.",
            if forwarded(p) { "High: your router forwards it to the internet." } else { "Moderate: someone would need to be on your network, or another device on it would need to be infected first." },
            &["Open the device's app or settings page.", "Look for Telnet, Remote access or Debug mode and turn it off.", "If there's no switch, update the firmware.", "Check again in Porchlight."]));
    }
    if deep.rtsp_open {
        out.push(f("PL-RTSP-OPEN", if forwarded(554) { "fix-soon" } else { "worth-fixing" }, Some(d), "Camera video can be watched without a password".into(), format!("{n} sends its live video to anyone who asks, without a password."),
            "Anyone connected to your Wi-Fi can open the video feed.", "Moderate: it needs someone on your Wi-Fi, like a guest or a neighbour who knows the password.",
            &["Open the camera's app or web page.", "Turn on \"Authentication\" for RTSP (sometimes called \"RTSP password\").", "If you don't use the camera with other apps, turn RTSP off.", "Check again in Porchlight."]));
    }
    if has(21) {
        out.push(f("PL-FTP", "worth-fixing", Some(d), "Old file-sharing service (FTP) is on".into(),
            if d.is_router { "Your router runs an FTP server: an old way of sharing files (usually a USB drive plugged into the router) that sends passwords and files unencrypted.".into() } else { format!("{n} runs FTP, an old way of sharing files that sends passwords and files unencrypted.") },
            "Someone on your network could read the FTP password while it's being used, then open the shared files.", "Low to moderate: it needs someone already on your network.",
            if d.is_router { &["Open your router's settings page and log in.", "Look under USB, Storage or File sharing and turn FTP off.", "If you share a USB drive this way, keep it on but give it a strong password."] } else { &["In the device's settings, turn off FTP.", "If you need file sharing, use the device's app or SFTP instead."] }));
    }
    if deep.smb1 {
        out.push(f("PL-SMB1", "worth-fixing", Some(d), "Old file-sharing protocol SMBv1 is on".into(), format!("{n} still accepts SMB version 1, the Windows file-sharing protocol from the 1990s."),
            "SMBv1 has no protection against tampering, and it's what the 2017 WannaCry outbreak spread through on unpatched Windows.", "Low to moderate: it needs someone on your network.",
            if d.is_router { &["Open your router's settings page and log in.", "Under USB, Storage or File sharing (Samba), set the minimum SMB version to SMB2, or turn file sharing off."] } else { &["Open PowerShell as administrator and run: Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol", "Restart, then check again."] }));
    }
    if deep.rdp_no_nla {
        out.push(f("PL-RDP-NLA", if forwarded(3389) { "fix-soon" } else { "worth-fixing" }, Some(d), "Remote Desktop doesn't require sign-in first".into(), format!("{n} lets anyone reach its Windows sign-in screen over Remote Desktop before proving who they are."),
            "With Network Level Authentication on, Windows checks the password before starting a session; without it, flaws that work before sign-in (like BlueKeep) are reachable.", "Moderate: it needs someone on your network.",
            &["On that computer: Settings → System → Remote Desktop → Advanced settings.", "Tick \"Require computers to use Network Level Authentication to connect\"."]));
    }
    if has(5555) {
        out.push(f("PL-ADB", "worth-fixing", Some(d), "Android debugging is open to the network".into(), format!("{n} accepts connections on the Android debugging port. This is common on Android TV boxes."),
            "On many devices this lets anyone on your network install apps and control the device without a password.", "Moderate: malware that spreads between Android TV boxes looks for exactly this port.",
            &["On the device: Settings → Developer options.", "Turn off \"USB debugging\", \"Network debugging\" or \"ADB debugging\".", "If you can't find Developer options, check for a firmware update."]));
    }
    if has(5900) {
        out.push(f("PL-VNC", "worth-fixing", Some(d), "Remote screen control (VNC) is on".into(), format!("{n} lets people control its screen remotely."),
            "Many VNC setups use a short password or none, which would let someone on your network see and control the screen.", "Moderate: it needs someone on your network.",
            &["If you don't use remote control, turn VNC off.", "If you do, set a long password (12+ characters)."]));
    }
    if has(2375) {
        out.push(f("PL-DOCKER", "worth-fixing", Some(d), "Docker can be controlled over the network without a password".into(), format!("{n} accepts Docker remote-control connections on port 2375."),
            "Anyone on your network who connects can start programs on that computer with full control.", "Moderate: automated tools look for this port.",
            &["Docker Desktop → Settings → General: untick \"Expose daemon on tcp://localhost:2375\"."]));
    }
    if has(34567) {
        out.push(f("PL-XMEYE", "worth-fixing", Some(d), "Remote-viewing service with a history of security flaws".into(), format!("{n} runs the \"XMEye\" service used by many low-cost cameras and recorders."),
            "This service has had several serious, publicly known flaws; older firmware is the main risk.", "Moderate: it's reachable inside your network.",
            &["Update the recorder or camera firmware.", "Turn off \"Cloud\" / \"P2P\" access if you don't watch it away from home."]));
    }
    if has(1883) {
        out.push(f("PL-MQTT", "good-to-know", Some(d), "Smart-home messages are not encrypted".into(), format!("{n} runs an MQTT server without encryption."),
            "Devices on your network could read or send smart-home commands through it if it has no password.", "Low: it needs someone on your network.",
            &["In your smart-home hub's settings, make sure MQTT requires a username and password."]));
    }
    if !d.is_router && (d.kind == "camera" || d.kind == "Wi-Fi extender") && (has(80) || has(8080)) {
        out.push(f("PL-DEFAULT-PASSWORD", "good-to-know", Some(d), format!("Make sure the {} has its own admin password", if d.kind == "camera" { "camera" } else { "Wi-Fi extender" }),
            format!("{n} has a settings page at http://{}/.", d.ip),
            "Porchlight never tries passwords, so it can't tell whether the factory password (often blank or \"admin\") is still set. Whoever knows it can change the device's settings.",
            "Low, once you've set your own password.", &["Open its settings page in a browser.", "If it lets you in with no password or with \"admin\", set your own (12+ characters)."]));
    }
}

fn wifi_findings(v: &WifiView, real: &[AccessPoint], copies: &[AccessPoint], out: &mut Vec<Finding>) {
    let Some(home) = &v.home_ssid else { return };
    for n in &v.yours {
        let p = n.protection.as_str();
        if matches!(p, "Open" | "WEP" | "WPA" | "WPA2 (old TKIP)") {
            let (level, why) = match p {
                "Open" => ("fix-soon", "Anyone nearby can join it and see what's on your network."),
                "WEP" => ("fix-soon", "WEP can be cracked in minutes with free tools."),
                _ => ("worth-fixing", "This protection is outdated; WPA2 (AES) or WPA3 is the safe choice."),
            };
            out.push(f("PL-WIFI-WEAK", level, None, format!("Your Wi-Fi \"{}\" uses {}", n.ssid, if p == "Open" { "no password".to_string() } else { p.to_string() }), format!("\"{}\" ({}) is protected with {p}.", n.ssid, n.source), why,
                "High for open or WEP networks: anyone within range can get in.", &["Open your router's settings page.", "Wi-Fi → Security: choose WPA2-Personal (AES) or WPA3 with a password of 12+ characters.", "Reconnect your devices."]));
        }
        if n.wps {
            out.push(f("PL-WPS", "worth-fixing", None, format!("WPS is on for \"{}\"", n.ssid), format!("\"{}\" ({}) announces WPS, the \"press a button or type an 8-digit PIN to connect\" feature.", n.ssid, n.source),
                "The PIN part of WPS has a known design weakness: on some devices, someone within range can work out the PIN and get your Wi-Fi password, however long it is.",
                "Low to moderate: it needs someone within range, and it only works on some models.", &["Open the settings page of the router or extender that broadcasts it.", "Find WPS (under Wireless or WLAN) and turn it off."]));
        }
    }
    if let Some(ap) = real.first() {
        if !ap.security.pmf_capable && wifi::strength(wifi::protection(&ap.security)) >= 3 {
            out.push(f("PL-NO-PMF", "worth-fixing", None, format!("\"{home}\" doesn't protect against kick-off attacks"), format!("Your router doesn't use Protected Management Frames (802.11w) on \"{home}\"."),
                "Without them, anyone within range can send fake \"disconnect\" messages that kick your devices off the Wi-Fi at will (a deauthentication attack). It's also the first step of many Wi-Fi attacks: kick a phone off, then catch it reconnecting.",
                "Low to moderate: it needs someone within range with a Wi-Fi adapter, and the free tools for it are well known.",
                &["Open your router's settings page → Wi-Fi security.", "Choose WPA2/WPA3 mixed or WPA3 if offered (WPA3 always protects management frames).", "Or look for \"PMF\", \"802.11w\" or \"Management Frame Protection\" and set it to Optional (Capable) or Required."]));
        }
    }
    for c in copies {
        let weaker = wifi::strength(wifi::protection(&c.security)) < real.iter().map(|a| wifi::strength(wifi::protection(&a.security))).max().unwrap_or(-1);
        out.push(f(if weaker { "PL-EVIL-TWIN" } else { "PL-SSID-DUPLICATE" }, if weaker { "worth-fixing" } else { "good-to-know" }, None,
            if weaker { "A network with weaker protection is using your Wi-Fi's name".to_string() } else { "Another access point uses your Wi-Fi's name".into() },
            format!("An access point that isn't yours broadcasts \"{}\" ({}).", c.ssid, wifi::protection(&c.security)),
            "Phones join networks by name. A copy can trick a device into joining it, and whoever runs it could see that device's unencrypted traffic.",
            "Low to moderate: it could also be a neighbour with the same default name.",
            &["Don't connect to it.", "Give your Wi-Fi a unique name so copies stand out.", "Porchlight will tell you if it keeps appearing."]));
    }
    if !v.saved_open_auto.is_empty() {
        let list = v.saved_open_auto.iter().map(|s| format!("\"{}\"", s.ssid)).collect::<Vec<_>>().join(", ");
        out.push(f("PL-SAVED-OPEN", "worth-fixing", None, format!("This computer joins {} open Wi-Fi network{} by itself", v.saved_open_auto.len(), if v.saved_open_auto.len() == 1 { "" } else { "s" }),
            format!("Saved and set to connect automatically: {list}."),
            "Anyone can create a fake hotspot with one of these names, and this computer will join it without asking, because open networks can't prove who they are. That's how \"MANA\" and \"KARMA\" attacks work.",
            "Moderate when you're away from home (cafés, airports, school), where these attacks are set up.",
            &["Settings → Network & internet → Wi-Fi → Manage known networks.", "Forget the open networks above, or open each one and turn off \"Connect automatically\"."]));
    }
    if !v.saved_hidden.is_empty() {
        let list = v.saved_hidden.iter().map(|s| format!("\"{}\"", s.ssid)).collect::<Vec<_>>().join(", ");
        out.push(f("PL-SAVED-HIDDEN", "good-to-know", None, "This computer calls out for hidden networks".into(), format!("Saved as hidden networks: {list}."),
            "To find a hidden network, this computer keeps calling its name everywhere it goes, which tells anyone listening which networks to fake.", "Low.",
            &["If you don't need them, forget these networks in Settings → Wi-Fi → Manage known networks."]));
    }
}

/// The score counts only problems the user hasn't said are fine.
fn score_with(findings: &[Finding], accepted: &[String]) -> u32 {
    let open: Vec<Finding> = findings.iter().filter(|f| !accepted.contains(&finding_key(f))).cloned().collect();
    score(&open)
}

fn score(findings: &[Finding]) -> u32 {
    let cost: u32 = findings.iter().map(|f| match f.level.as_str() { "fix-soon" => 25, "worth-fixing" => 10, _ => 0 }).sum();
    100u32.saturating_sub(cost)
}

/// Devices sharing one MAC (phones behind a MAC-rewriting repeater) are keyed by MAC and address.
pub fn device_key(mac: &[u8; 6], ip: Ipv4Addr, shared: bool) -> String {
    if shared { format!("{}@{ip}", mac_str(mac)) } else { mac_str(mac) }
}

/// Devices other than the router that answer with the router's hardware address: the sign of ARP spoofing.
pub fn impersonators(found: &[(Ipv4Addr, [u8; 6])], gateway: Ipv4Addr) -> Vec<Ipv4Addr> {
    let Some(gm) = found.iter().find(|(ip, _)| *ip == gateway).map(|(_, m)| *m) else { return Vec::new() };
    found.iter().filter(|(ip, m)| *ip != gateway && *m == gm).map(|(ip, _)| *ip).collect()
}

/// Copies of your Wi-Fi with weaker protection than your real access points.
pub fn weaker_copies<'a>(real: &[AccessPoint], copies: &'a [AccessPoint]) -> Vec<&'a AccessPoint> {
    let best = real.iter().map(|a| wifi::strength(wifi::protection(&a.security))).max().unwrap_or(-1);
    copies.iter().filter(|c| wifi::strength(wifi::protection(&c.security)) < best).collect()
}

fn watch_router(state: &mut State, found: &[(Ipv4Addr, [u8; 6])], gateway: Ipv4Addr, alerts: &mut Vec<Alert>) {
    let Some(gm) = found.iter().find(|(ip, _)| *ip == gateway).map(|(_, m)| mac_str(m)) else {
        crate::log_warn!("the router at {gateway} didn't answer this time");
        return;
    };
    let fakes: Vec<String> = impersonators(found, gateway).iter().map(|ip| ip.to_string()).collect();
    if !fakes.is_empty() {
        crate::log_warn!("devices answering with the router's MAC: {}", fakes.join(", "));
        if state.first_time(format!("spoof:{gm}:{}", fakes.join(","))) {
            alerts.push(state.alert("urgent", "Another device is answering as your router".into(),
                format!("The device at {} uses the same hardware address as your router. That's how a \"man-in-the-middle\" attack starts: traffic meant for the router goes through that device first. Unplug or switch off devices you don't recognise, then restart your router.", fakes.join(", ")), None));
        }
    }
    match state.home.as_ref().and_then(|h| h.router_mac.clone()) {
        None => {
            if let Some(h) = state.home.as_mut() {
                h.router_mac = Some(gm);
            }
        }
        Some(old) if old != gm => {
            crate::log_warn!("router identity changed");
            if state.first_time(format!("router-changed:{gm}")) {
                alerts.push(state.alert("urgent", "Your router's identity changed".into(),
                    format!("Your router used to have the hardware address {old}; now something at the router's address answers with {gm}. If you didn't replace your router, another device may be pretending to be it. If you did, open Porchlight and tap \"I replaced my router\"."), None));
            }
        }
        _ => {}
    }
}

/// Adds what the sweep found to the device memory; returns the keys of devices never seen before.
fn merge_devices(state: &mut State, found: &[(Ipv4Addr, [u8; 6])], netw: &Network, t: u64) -> Vec<String> {
    let mut mac_count: HashMap<[u8; 6], usize> = HashMap::new();
    for (_, m) in found {
        *mac_count.entry(*m).or_default() += 1;
    }
    let seen: HashSet<String> = found.iter().map(|(ip, m)| device_key(m, *ip, mac_count[m] > 1)).collect();
    for d in state.devices.values_mut() {
        d.online = seen.contains(&d.key) || d.is_self;
    }
    let mut fresh = Vec::new();
    for (ip, m) in found {
        let shared = mac_count[m] > 1;
        let key = device_key(m, *ip, shared);
        if !state.devices.contains_key(&key) {
            fresh.push(key.clone());
        }
        let d = state.devices.entry(key.clone()).or_insert_with(|| Device { key: key.clone(), first_seen: t, ..Default::default() });
        d.ip = ip.to_string();
        d.mac = mac_str(m);
        d.vendor = names::vendor(m).map(String::from);
        d.private_mac = names::is_private_mac(m);
        d.is_router = *ip == netw.gateway;
        d.behind_repeater = shared;
        d.last_seen = t;
        d.online = true;
    }
    let me = state.devices.entry("self".into()).or_insert_with(|| Device { key: "self".into(), first_seen: t, is_self: true, ..Default::default() });
    me.ip = netw.address.to_string();
    me.is_self = true;
    me.online = true;
    me.last_seen = t;
    fresh
}

fn name_devices(state: &mut State, upnp: &HashMap<Ipv4Addr, Upnp>, survey: &Survey, router: Ipv4Addr) {
    // Each device takes up to a few seconds to answer (or not), so ask two dozen at a time.
    let online: Vec<Device> = state.devices.values().filter(|d| d.online).cloned().collect();
    let named: Vec<Device> = std::thread::scope(|s| {
        online
            .chunks(24)
            .flat_map(|chunk| {
                let handles: Vec<_> = chunk.iter().cloned().map(|mut d| s.spawn(move || {
                    refresh_names(&mut d, upnp, router);
                    d
                })).collect();
                handles.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>()
            })
            .collect()
    });
    let others: Vec<&Device> = named.iter().filter(|d| !d.is_self && !d.is_router).collect();
    crate::log_info!("names: {} of {} devices announced a name", others.iter().filter(|d| own_name(d).is_some()).count(), others.len());
    for d in named {
        state.devices.insert(d.key.clone(), d);
    }
    for d in state.devices.values_mut() {
        // The device sharing its MAC with others that has its own settings page is the repeater itself.
        if d.behind_repeater && d.web_title.is_some() {
            d.behind_repeater = false;
        }
        let mine = !d.behind_repeater && !d.is_self && !d.mac.is_empty();
        let names: HashSet<String> = survey.aps.iter().filter(|a| mine && same_hardware(&d.mac, &a.bssid)).map(|a| a.ssid.clone()).collect();
        d.broadcasts = names.into_iter().collect();
    }
}

fn knock_doors(state: &mut State, keys: &[String], t: u64, progress: &dyn Fn(&str)) {
    let jobs: Vec<(String, Ipv4Addr)> = keys.iter().filter_map(|k| state.devices.get(k).filter(|d| d.online).and_then(|d| d.ip.parse().ok().map(|ip| (k.clone(), ip)))).collect();
    if jobs.is_empty() {
        return;
    }
    progress(&format!("Checking {} device{} for open doors", jobs.len(), if jobs.len() == 1 { "" } else { "s" }));
    let results: Vec<(String, DeepResult)> = std::thread::scope(|s| {
        let handles: Vec<_> = jobs.iter().map(|(k, ip)| s.spawn(move || (k.clone(), checks::deep_check(*ip, t)))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    for (k, r) in results {
        if let Some(d) = state.devices.get_mut(&k) {
            d.deep = Some(r);
        }
    }
}

/// Doors devices opened to the internet through the router (UPnP): listed, never changed.
fn read_upnp(state: &mut State, upnp: &HashMap<Ipv4Addr, Upnp>, gateway: Ipv4Addr) {
    state.upnp_on = Some(false);
    state.mappings.clear();
    if let Some((port, ctl)) = upnp.get(&gateway).and_then(|u| u.igd_control.as_ref()) {
        state.upnp_on = Some(true);
        state.mappings = names::list_mappings(gateway, *port, ctl);
    }
}

fn new_device_alerts(state: &mut State, fresh: &[String], alerts: &mut Vec<Alert>) {
    if !state.baseline_done || !state.settings.notify {
        return;
    }
    for k in fresh {
        let Some(d) = state.devices.get(k).cloned() else { continue };
        if is_this_pc(&d) {
            continue;
        }
        let doors = d.deep.as_ref().filter(|x| !x.ports.is_empty()).map(|x| format!(" Open doors: {}.", x.ports.iter().map(|p| checks::port_name(*p)).collect::<Vec<_>>().join(", "))).unwrap_or_default();
        let who = if d.name.eq_ignore_ascii_case(&d.kind) { format!("A {} ({})", d.kind, d.ip) } else { format!("{} ({}, {})", d.name, d.kind, d.ip) };
        alerts.push(state.alert("warning", format!("New device: {}", d.name), format!("{who} joined your network.{doors} If you don't recognise it, change your Wi-Fi password."), Some(k.clone())));
    }
}

fn mapping_findings(state: &State, out: &mut Vec<Finding>) {
    // A mapping to any of this computer's addresses (a second adapter, a virtual network) belongs to this computer.
    let mine: Vec<String> = if state.mappings.is_empty() { Vec::new() } else { net::local_addresses().iter().map(|ip| ip.to_string()).collect() };
    for m in &state.mappings {
        let name = if mine.contains(&m.internal_client) {
            format!("This computer ({})", m.internal_client)
        } else {
            state.devices.values().find(|d| d.ip == m.internal_client).map(|d| d.name.clone()).unwrap_or_else(|| m.internal_client.clone())
        };
        let sensitive = [21, 23, 80, 554, 8000, 8080, 8554, 34567, 37777, 3389, 5900].contains(&m.internal_port);
        out.push(Finding { id: "PL-UPNP-MAPPING".into(), level: if sensitive { "fix-soon" } else { "worth-fixing" }.into(), title: "A device opened a door to the internet by itself".into(),
            found: format!("{name} asked your router to open port {} ({}) to the internet{}.", m.external_port, m.protocol, if m.description.is_empty() { String::new() } else { format!(", labelled \"{}\"", m.description) }),
            means: "Anyone on the internet can now reach that device through this port, not just people in your home.".into(),
            likely: if sensitive { "High: internet-wide scanners look for exactly these services." } else { "Low to moderate, depending on what's listening." }.into(),
            fix: vec!["If you don't recognise it: in your router's settings, turn off UPnP, then restart the device.".into()], device: None });
    }
}

fn level_order(level: &str) -> u8 {
    match level {
        "fix-soon" => 0,
        "worth-fixing" => 1,
        "good-to-know" => 2,
        _ => 3,
    }
}

fn finding_key(f: &Finding) -> String {
    format!("{}|{}", f.id, f.device.clone().unwrap_or_default())
}

/// Every finding, recomputed from what is known now, most urgent first.
fn all_findings(state: &State, real: &[AccessPoint], copies: &[AccessPoint], extra: Vec<Finding>) -> Vec<Finding> {
    let mut out = Vec::new();
    for d in state.devices.values().filter(|d| d.online || d.is_router) {
        device_findings(d, &state.mappings, &mut out);
    }
    wifi_findings(&state.wifi, real, copies, &mut out);
    mapping_findings(state, &mut out);
    out.extend(extra);
    out.sort_by_key(|f| level_order(&f.level));
    out
}

/// Problems that weren't there last time. Fake copies of your Wi-Fi have their own, louder alert.
fn risk_alerts(state: &mut State, previous: &HashSet<String>, findings: &[Finding], alerts: &mut Vec<Alert>) {
    if !state.baseline_done || !state.settings.notify {
        return;
    }
    let accepted = state.accepted.clone();
    for f in findings.iter().filter(|f| level_order(&f.level) <= 1 && f.id != "PL-EVIL-TWIN" && !accepted.contains(&finding_key(f))) {
        let key = finding_key(f);
        if !previous.contains(&key) && state.first_time(format!("finding:{key}")) {
            alerts.push(state.alert(if f.level == "fix-soon" { "urgent" } else { "warning" }, format!("New risk: {}", f.title), f.found.clone(), f.device.clone()));
        }
    }
}

fn copy_alerts(state: &mut State, real: &[AccessPoint], copies: &[AccessPoint], alerts: &mut Vec<Alert>) {
    for c in weaker_copies(real, copies) {
        // Recorded during the first look too, so a neighbour's long-standing copy doesn't alert later.
        if state.first_time(format!("copy:{}", c.bssid)) && state.baseline_done {
            crate::log_warn!("weaker copy of the home Wi-Fi name seen ({})", wifi::protection(&c.security));
            alerts.push(state.alert("urgent", format!("A fake copy of \"{}\" appeared", c.ssid), format!("An access point nearby broadcasts your Wi-Fi's name with {} protection. Don't connect to it; your devices should stay on your real network.", wifi::protection(&c.security)), None));
        }
    }
}

/// The first complete look sets the baseline: nothing already on the network counts as "new".
fn set_baseline(state: &mut State, t: u64, alerts: &mut Vec<Alert>) {
    state.baseline_done = true;
    state.baseline_at = t;
    let keys: Vec<String> = state.findings.iter().map(|f| format!("finding:{}", finding_key(f))).collect();
    for k in keys {
        if !state.notified.contains(&k) {
            state.notified.push(k);
        }
    }
    let n = state.devices.values().filter(|d| d.online).count();
    alerts.push(state.alert("info", "Porchlight is watching your home".into(), format!("{n} devices are on your network. You'll get a notification if a new one joins, if something pretends to be your router, or if a new risk appears."), None));
}

/// Looks at the home network: who's there, who's new, whether the router is still the router, and every device's
/// doors (all of them on a full check, newcomers otherwise). Returns findings about this computer's own settings.
fn look_at_home(state: &mut State, netw: &Network, survey: &Survey, full: bool, t: u64, progress: &dyn Fn(&str), alerts: &mut Vec<Alert>) -> Vec<Finding> {
    progress("Looking for devices");
    let swept = std::time::Instant::now();
    // Other addresses of this computer (a second adapter, a virtual machine's network) are not visitors.
    let mine = net::local_addresses();
    let found: Vec<(Ipv4Addr, [u8; 6])> = net::sweep(&net::hosts(netw)).into_iter().filter(|(ip, _)| !mine.contains(ip)).collect();
    let upnp = names::ssdp(netw);
    crate::log_info!("sweep: {} answers, {} UPnP devices in {:.1}s", found.len(), upnp.len(), swept.elapsed().as_secs_f32());
    watch_router(state, &found, netw.gateway, alerts);
    let fresh = merge_devices(state, &found, netw, t);
    progress("Naming devices");
    name_devices(state, &upnp, survey, netw.gateway);
    let doors: Vec<String> = if full { state.devices.keys().cloned().collect() } else { fresh.clone() };
    knock_doors(state, &doors, t, progress);
    if full {
        state.last_full = t;
    }
    read_upnp(state, &upnp, netw.gateway);
    for d in state.devices.values_mut() {
        d.kind = kind_of(d);
        d.name = name_of(d);
    }
    disambiguate(&mut state.devices);
    new_device_alerts(state, &fresh, alerts);
    progress("Checking this computer's DNS and IPv6");
    let mut me = crate::system::look(full);
    match me.invents {
        Some(v) => state.dns_invents = Some(v),
        None => me.invents = state.dns_invents,
    }
    let dns: Vec<String> = me.dns.iter().map(|d| d.to_string()).collect();
    watch_dns(state, &dns, alerts);
    crate::system::findings(&me, netw, &state.devices)
}

// ---------- kick-off (deauthentication) attacks, from live Wi-Fi events ----------

/// A drop followed by a reconnect to the same network within this many seconds is a "bounce".
pub const BOUNCE_GAP: u64 = 60;
/// Bounces counted over this many seconds...
pub const BOUNCE_WINDOW: u64 = 300;
/// ...and this many of them look like someone kicking devices off on purpose.
pub const BOUNCES: usize = 3;
/// At most one kick-off alert per this many seconds.
pub const BOUNCE_QUIET: u64 = 1800;

/// Spots the pattern of a kick-off attack: this computer dropping off a Wi-Fi network and getting straight back on,
/// again and again within minutes. One drop (sleep, the router restarting, walking out of range) never counts.
#[derive(Debug, Default)]
pub struct KickWatch {
    dropped: Option<(String, u64)>,
    bounces: Vec<u64>,
    last_alert: Option<u64>,
}

impl KickWatch {
    pub fn disconnected(&mut self, ssid: &str, t: u64) {
        self.dropped = Some((ssid.to_string(), t));
    }

    /// Returns the number of quick bounces when there are enough of them to warn about.
    pub fn connected(&mut self, ssid: &str, t: u64) -> Option<usize> {
        let (was, at) = self.dropped.take()?;
        if was != ssid || t.saturating_sub(at) > BOUNCE_GAP {
            return None;
        }
        self.bounces.push(t);
        self.bounces.retain(|b| t.saturating_sub(*b) <= BOUNCE_WINDOW);
        let quiet = self.last_alert.map_or(true, |l| t.saturating_sub(l) > BOUNCE_QUIET);
        if self.bounces.len() >= BOUNCES && quiet {
            self.last_alert = Some(t);
            return Some(self.bounces.len());
        }
        None
    }
}

/// The alert for repeated kick-offs. `quality` is the signal strength (0-100) right after reconnecting: with a
/// weak signal, drops are expected and nothing is said.
pub fn kicked_off(state: &mut State, ssid: &str, bounces: usize, quality: u32) -> Option<Alert> {
    if quality < 40 {
        crate::log_info!("{bounces} quick Wi-Fi drops, but the signal is weak ({quality}%): not alerting");
        return None;
    }
    let unprotected = state.findings.iter().any(|f| f.id == "PL-NO-PMF");
    let why = if unprotected {
        " Your router doesn't use Protected Management Frames, which is what stops this (see Wi-Fi in Porchlight)."
    } else {
        " Your router protects against fake disconnect messages, so this may also be interference or a router problem."
    };
    crate::log_warn!("kick-off pattern: {bounces} drops and reconnects in {} minutes", BOUNCE_WINDOW / 60);
    Some(state.alert("urgent", format!("Something keeps kicking this computer off \"{ssid}\""),
        format!("This computer dropped off the Wi-Fi and reconnected {bounces} times in the last {} minutes, with a good signal. That's the pattern of a \"kick-off\" (deauthentication) attack, often used to push devices onto a fake copy of a network.{why} Porchlight is checking for copies of your Wi-Fi now.", BOUNCE_WINDOW / 60), None))
}

// ---------- DNS: the address book every website visit starts with ----------

/// True when this computer's DNS servers changed since the first look (ignoring order). Malware that takes over a
/// router (like DNSChanger) does exactly this.
pub fn dns_changed(before: &[String], now: &[String]) -> bool {
    if before.is_empty() || now.is_empty() {
        return false;
    }
    let (a, b): (HashSet<&String>, HashSet<&String>) = (before.iter().collect(), now.iter().collect());
    a != b
}

fn watch_dns(state: &mut State, servers: &[String], alerts: &mut Vec<Alert>) {
    let Some(home) = state.home.as_mut() else { return };
    if home.dns.is_empty() {
        home.dns = servers.to_vec();
        return;
    }
    if !dns_changed(&home.dns, servers) {
        return;
    }
    let (old, new) = (home.dns.join(", "), servers.join(", "));
    home.dns = servers.to_vec();
    crate::log_warn!("DNS servers changed: {old} -> {new}");
    if state.baseline_done && state.first_time(format!("dns:{new}")) {
        alerts.push(state.alert("warning", "Your DNS servers changed".into(),
            format!("This computer used to look up websites through {old}; now it uses {new}. If you or a VPN or ad-blocking app didn't change this, someone may have changed your router's settings to send you to fake websites. Open your router's settings, check the DNS servers, and change the router's admin password."), None));
    }
}

/// A check works on a copy of the state. Before the copy replaces the live state, keep whatever happened in the
/// meantime: names the user gave, settings, devices they removed, alerts they read, and alerts raised outside
/// the check (a kick-off warning). `began` is when the copy was taken.
pub fn keep_user_changes(work: &mut State, live: &State, began: u64) {
    work.settings = live.settings.clone();
    work.accepted = live.accepted.clone();
    for (k, d) in work.devices.iter_mut() {
        if let Some(l) = live.devices.get(k) {
            d.custom_name = l.custom_name.clone();
            d.owner = l.owner;
            if let Some(n) = &d.custom_name {
                d.name = n.clone();
            }
        }
    }
    // Removed while the check ran: stays removed, unless the check just found it again.
    let last = work.last_check;
    work.devices.retain(|k, d| live.devices.contains_key(k) || d.last_seen >= last);
    for a in work.alerts.iter_mut().filter(|a| a.at < began) {
        if live.alerts.iter().any(|l| l.id == a.id && l.read) {
            a.read = true;
        }
    }
    let raised: Vec<Alert> = live.alerts.iter().filter(|l| l.at >= began && !work.alerts.iter().any(|w| w.at == l.at && w.title == l.title)).cloned().collect();
    for mut a in raised.into_iter().rev() {
        work.next_alert += 1;
        a.id = work.next_alert;
        work.alerts.insert(0, a);
    }
    for k in &live.notified {
        if !work.notified.contains(k) {
            work.notified.push(k.clone());
        }
    }
}

/// One check. `full` also knocks on each device's doors (on demand, daily, and always for new devices).
/// Returns the alerts worth a notification.
pub fn check(state: &mut State, full: bool, progress: &dyn Fn(&str)) -> Vec<Alert> {
    let started = std::time::Instant::now();
    let mut alerts = Vec::new();
    let t = now();
    progress("Finding your network");
    let Some(netw) = net::find_network() else {
        crate::log_warn!("no default route: not connected");
        state.status = "Not connected to a network".into();
        state.on_home = false;
        state.last_check = t;
        return alerts;
    };
    if state.home.is_none() {
        state.home = Some(Home { cidr: netw.cidr.clone(), gateway: netw.gateway.to_string(), router_mac: None, dns: Vec::new() });
    }
    let home = state.home.clone().unwrap_or_default();
    state.on_home = home.cidr == netw.cidr && home.gateway == netw.gateway.to_string();
    state.network = Some(netw.clone());

    progress("Listening to your Wi-Fi");
    let survey = wifi::survey(true);
    let extra = if state.on_home { look_at_home(state, &netw, &survey, full, t, progress, &mut alerts) } else { Vec::new() };

    let (view, real, copies) = wifi_view(&survey, state.settings.home_ssid.as_deref(), &state.devices);
    state.wifi = view;
    copy_alerts(state, &real, &copies, &mut alerts);
    let previous: HashSet<String> = state.findings.iter().map(finding_key).collect();
    let findings = all_findings(state, &real, &copies, extra);
    risk_alerts(state, &previous, &findings, &mut alerts);
    state.score = score_with(&findings, &state.accepted);
    state.findings = findings;
    state.last_check = t;
    let online = state.devices.values().filter(|d| d.online).count();
    state.status = if state.on_home { format!("Watching {online} devices") } else { "You're on a different network; Porchlight watches your home network".into() };
    if !state.baseline_done && state.on_home {
        set_baseline(state, t, &mut alerts);
    }
    crate::log_info!("check done in {:.1}s: on_home={}, {online} online, {} findings, {} alerts, full={full}", started.elapsed().as_secs_f32(), state.on_home, state.findings.len(), alerts.len());
    alerts
}

// ---------- diagnostics for beta testers: what happened, never who or where ----------

/// Replaces IPv4/IPv6 addresses and MAC addresses in a line of text.
pub fn scrub(line: &str) -> String {
    let addr_char = |c: char| c.is_ascii_hexdigit() || c == '.' || c == ':';
    let mut out = String::with_capacity(line.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        let core = run.trim_end_matches(['.', ':']);
        let tail = &run[core.len()..];
        let colons = core.matches(':').count();
        let replaced = if core.parse::<Ipv4Addr>().is_ok() {
            Some("[ip]")
        } else if core.len() == 17 && colons == 5 {
            Some("[mac]")
        } else if colons >= 2 && core.parse::<std::net::Ipv6Addr>().is_ok() {
            Some("[ip6]")
        } else {
            None
        };
        match replaced {
            Some(r) => {
                out.push_str(r);
                out.push_str(tail);
            }
            None => out.push_str(run),
        }
        run.clear();
    };
    for c in line.chars() {
        if addr_char(c) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// A plain-text report a beta tester can attach to a bug report. It has counts, check IDs and timings; it leaves
/// out device names, network names and addresses.
pub fn diagnostics(state: &State, version: &str, windows: &str, listening: bool, log: &[String]) -> String {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    for d in state.devices.values().filter(|d| d.online) {
        *kinds.entry(d.kind.as_str()).or_default() += 1;
    }
    let named = state.devices.values().filter(|d| d.online && (d.detected_name.is_some() || d.upnp_name.is_some() || d.web_title.is_some())).count();
    let mut r = String::new();
    let mut line = |s: String| {
        r.push_str(&s);
        r.push('\n');
    };
    line(format!("Porchlight {version} diagnostics ({})", crate::log::timestamp(now())));
    line(format!("Windows: {}", if windows.is_empty() { "unknown" } else { windows }));
    line(format!("On home network: {}; baseline done: {}; kick-off watch: {}", state.on_home, state.baseline_done, if listening { "listening" } else { "off" }));
    line(format!("Last check: {}; last full checkup: {}", crate::log::timestamp(state.last_check), crate::log::timestamp(state.last_full)));
    line(format!("Devices: {} online, {} remembered, {named} named automatically", kinds.values().sum::<usize>(), state.devices.len()));
    for (k, n) in &kinds {
        line(format!("  {n} x {k}"));
    }
    line(format!("Wi-Fi: {} adapter(s), {} of your networks ({}), {} copies, {} saved networks", state.wifi.adapters.len(), state.wifi.yours.len(),
        state.wifi.yours.iter().map(|w| format!("{} / PMF {} / WPS {}", w.protection, w.pmf, if w.wps { "on" } else { "off" })).collect::<Vec<_>>().join("; "), state.wifi.copies.len(), state.wifi.saved_count));
    line(format!("Findings ({}, score {}):", state.findings.len(), state.score));
    for f in &state.findings {
        line(format!("  {} [{}]", f.id, f.level));
    }
    line(format!("Alerts: {} total, {} unread", state.alerts.len(), state.alerts.iter().filter(|a| !a.read).count()));
    line("Recent log (addresses removed):".into());
    for l in log {
        line(format!("  {}", scrub(l)));
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wifi::{Connection, Security};

    #[test]
    fn devices_with_the_same_name_can_be_told_apart() {
        let mut devices = BTreeMap::new();
        for (k, ip) in [("a", "10.9.8.23"), ("b", "10.9.8.41")] {
            devices.insert(k.to_string(), Device { name: "Phone, tablet or laptop".into(), ..device(k, "02:aa:bb:cc:dd:01", ip) });
        }
        disambiguate(&mut devices);
        assert_eq!(devices["a"].name, "Phone, tablet or laptop (.23)");
    }

    #[test]
    fn a_name_announced_by_a_service_beats_a_host_name() {
        let d = Device { kind: "phone or tablet".into(), router_name: Some("iPhone".into()), service_name: Some("Sara's iPhone".into()), ..Default::default() };
        assert_eq!(name_of(&d), "Sara's iPhone");
    }

    // ---------- diagnostics ----------
    #[test]
    fn scrub_removes_addresses_but_keeps_words() {
        assert_eq!(scrub("router at 10.9.8.1 answered as 02:aa:bb:cc:dd:01."), "router at [ip] answered as [mac].");
        assert_eq!(scrub("dns fe80::1 added, 3 devices"), "dns [ip6] added, 3 devices");
    }

    #[test]
    fn diagnostics_leave_out_names_and_networks() {
        let mut s = watched();
        s.devices.insert("k".into(), Device { name: "Sara's laptop".into(), kind: "computer".into(), ..device("k", "02:aa:bb:cc:dd:01", "10.9.8.5") });
        s.wifi.yours.push(WifiNet { ssid: "Home".into(), protection: "WPA2".into(), ..Default::default() });
        let text = diagnostics(&s, "0.6.0", "Microsoft Windows", true, &["sweep at 10.9.8.5".into()]);
        assert!(text.contains("1 x computer"));
        assert!(!text.contains("Sara") && !text.contains("Home /") && !text.contains("10.9.8.5"));
    }

    // ---------- small builders (all addresses are made up) ----------
    fn wpa2() -> Security {
        Security { akms: vec!["PSK".into()], ciphers: vec!["CCMP".into()], ..Default::default() }
    }
    fn open() -> Security {
        Security::default()
    }
    fn ap(ssid: &str, bssid: &str, security: Security) -> AccessPoint {
        AccessPoint { ssid: ssid.into(), bssid: bssid.into(), rssi: -50, security, wps: None }
    }
    fn survey(connected: Option<(&str, &str)>, aps: Vec<AccessPoint>) -> Survey {
        Survey { connected: connected.map(|(s, b)| Connection { ssid: s.into(), bssid: b.into(), quality: 80 }), aps, ..Default::default() }
    }
    fn device(key: &str, mac: &str, ip: &str) -> Device {
        Device { key: key.into(), mac: mac.into(), ip: ip.into(), online: true, ..Default::default() }
    }
    fn ip(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }
    fn net() -> Network {
        Network { address: ip("10.9.8.20"), gateway: ip("10.9.8.1"), cidr: "10.9.8.0/24".into() }
    }
    fn watched() -> State {
        State { home: Some(Home { cidr: "10.9.8.0/24".into(), gateway: "10.9.8.1".into(), ..Default::default() }), baseline_done: true, ..Default::default() }
    }
    const ROUTER: [u8; 6] = [0x02, 0x11, 0x22, 0x33, 0x44, 0x55];
    const LAPTOP: [u8; 6] = [0x02, 0xaa, 0xbb, 0xcc, 0xdd, 0x01];

    // ---------- matching hardware ----------
    #[test]
    fn radios_and_routers_are_matched() {
        assert!(same_hardware("82:3a:7c:10:5e:21", "90:3a:7c:10:5e:21"));
        assert!(same_router("4c:11:22:33:44:55", "4e:11:22:43:44:55"));
        assert!(!same_router("4c:11:22:33:44:55", "20:aa:bb:cc:dd:ee"));
    }

    #[test]
    fn device_key_adds_the_address_only_when_a_mac_is_shared() {
        assert_eq!(device_key(&LAPTOP, ip("10.9.8.5"), false), "02:aa:bb:cc:dd:01");
        assert_eq!(device_key(&LAPTOP, ip("10.9.8.5"), true), "02:aa:bb:cc:dd:01@10.9.8.5");
    }

    // ---------- someone pretending to be the router ----------
    #[test]
    fn impersonators_finds_another_address_with_the_routers_mac() {
        let found = [(ip("10.9.8.1"), ROUTER), (ip("10.9.8.66"), ROUTER), (ip("10.9.8.5"), LAPTOP)];
        assert_eq!(impersonators(&found, ip("10.9.8.1")), vec![ip("10.9.8.66")]);
    }

    #[test]
    fn impersonators_is_empty_when_the_router_did_not_answer() {
        let found = [(ip("10.9.8.66"), ROUTER)];
        assert!(impersonators(&found, ip("10.9.8.1")).is_empty());
    }

    #[test]
    fn watch_router_remembers_the_router_the_first_time_without_alerting() {
        let mut s = watched();
        let mut alerts = Vec::new();
        watch_router(&mut s, &[(ip("10.9.8.1"), ROUTER)], ip("10.9.8.1"), &mut alerts);
        assert!(alerts.is_empty());
        assert_eq!(s.home.unwrap().router_mac.as_deref(), Some("02:11:22:33:44:55"));
    }

    #[test]
    fn watch_router_alerts_once_when_the_routers_identity_changes() {
        let mut s = watched();
        s.home.as_mut().unwrap().router_mac = Some("02:11:22:33:44:55".into());
        let mut alerts = Vec::new();
        let other = [(ip("10.9.8.1"), [0x02, 0xde, 0xad, 0xbe, 0xef, 0x00])];
        watch_router(&mut s, &other, ip("10.9.8.1"), &mut alerts);
        watch_router(&mut s, &other, ip("10.9.8.1"), &mut alerts);
        assert_eq!(alerts.iter().map(|a| a.title.as_str()).collect::<Vec<_>>(), vec!["Your router's identity changed"]);
    }

    #[test]
    fn watch_router_alerts_urgently_on_arp_spoofing() {
        let mut s = watched();
        let mut alerts = Vec::new();
        watch_router(&mut s, &[(ip("10.9.8.1"), ROUTER), (ip("10.9.8.66"), ROUTER)], ip("10.9.8.1"), &mut alerts);
        assert!(alerts.iter().any(|a| a.level == "urgent" && a.body.contains("10.9.8.66")));
    }

    // ---------- who's on the network ----------
    #[test]
    fn merge_devices_reports_a_device_as_new_only_once() {
        let mut s = watched();
        let found = [(ip("10.9.8.5"), LAPTOP)];
        assert_eq!(merge_devices(&mut s, &found, &net(), 100), vec!["02:aa:bb:cc:dd:01".to_string()]);
        assert!(merge_devices(&mut s, &found, &net(), 200).is_empty());
    }

    #[test]
    fn merge_devices_marks_devices_that_did_not_answer_as_offline() {
        let mut s = watched();
        merge_devices(&mut s, &[(ip("10.9.8.5"), LAPTOP)], &net(), 100);
        merge_devices(&mut s, &[], &net(), 200);
        assert!(!s.devices["02:aa:bb:cc:dd:01"].online);
        assert!(s.devices["self"].online);
    }

    #[test]
    fn new_device_alerts_wait_for_the_baseline() {
        let mut s = State::default();
        s.devices.insert("k".into(), device("k", "02:aa:bb:cc:dd:01", "10.9.8.5"));
        let mut alerts = Vec::new();
        new_device_alerts(&mut s, &["k".into()], &mut alerts);
        assert!(alerts.is_empty());
    }

    #[test]
    fn new_device_alerts_are_silent_when_notifications_are_off() {
        let mut s = watched();
        s.settings.notify = false;
        s.devices.insert("k".into(), device("k", "02:aa:bb:cc:dd:01", "10.9.8.5"));
        let mut alerts = Vec::new();
        new_device_alerts(&mut s, &["k".into()], &mut alerts);
        assert!(alerts.is_empty());
    }

    #[test]
    fn new_device_alert_names_the_device_and_its_open_doors() {
        let mut s = watched();
        let mut d = device("k", "02:aa:bb:cc:dd:01", "10.9.8.5");
        d.name = "Garage camera".into();
        d.kind = "camera".into();
        d.deep = Some(DeepResult { ports: vec![554], ..Default::default() });
        s.devices.insert("k".into(), d);
        let mut alerts = Vec::new();
        new_device_alerts(&mut s, &["k".into()], &mut alerts);
        assert_eq!(alerts[0].title, "New device: Garage camera");
        assert!(alerts[0].body.contains("Open doors"));
    }

    // ---------- new risks ----------
    fn telnet() -> Finding {
        Finding { id: "PL-TELNET".into(), level: "fix-soon".into(), title: "Telnet".into(), device: Some("k".into()), ..Default::default() }
    }

    #[test]
    fn risk_alerts_fire_for_a_new_problem() {
        let mut s = watched();
        let mut alerts = Vec::new();
        risk_alerts(&mut s, &HashSet::new(), &[telnet()], &mut alerts);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, "urgent");
    }

    #[test]
    fn risk_alerts_never_repeat_the_same_problem() {
        let mut s = watched();
        let mut alerts = Vec::new();
        risk_alerts(&mut s, &HashSet::new(), &[telnet()], &mut alerts);
        risk_alerts(&mut s, &HashSet::new(), &[telnet()], &mut alerts);
        assert_eq!(alerts.len(), 1);
    }

    #[test]
    fn risk_alerts_skip_good_to_know_findings() {
        let mut s = watched();
        let mut alerts = Vec::new();
        let tip = Finding { id: "PL-MQTT".into(), level: "good-to-know".into(), ..Default::default() };
        risk_alerts(&mut s, &HashSet::new(), &[tip], &mut alerts);
        assert!(alerts.is_empty());
    }

    #[test]
    fn the_baseline_marks_existing_problems_as_already_known() {
        let mut s = State { findings: vec![telnet()], ..Default::default() };
        let mut alerts = Vec::new();
        set_baseline(&mut s, 100, &mut alerts);
        let mut later = Vec::new();
        risk_alerts(&mut s, &HashSet::new(), &[telnet()], &mut later);
        assert!(later.is_empty());
        assert_eq!(alerts[0].level, "info");
    }

    // ---------- your Wi-Fi and copies of it ----------
    #[test]
    fn the_connected_access_point_is_yours_and_an_open_lookalike_is_a_copy() {
        let sv = survey(Some(("Home", "40:00:00:00:00:01")), vec![ap("Home", "40:00:00:00:00:01", wpa2()), ap("Home", "9a:12:34:56:78:9a", open())]);
        let (view, real, copies) = wifi_view(&sv, None, &BTreeMap::new());
        assert_eq!((real.len(), copies.len(), view.copies.len()), (1, 1, 1));
        assert_eq!(weaker_copies(&real, &copies).len(), 1);
    }

    #[test]
    fn a_second_band_from_the_same_router_is_not_a_copy() {
        let sv = survey(Some(("Home", "40:00:00:00:00:01")), vec![ap("Home", "40:00:00:00:00:01", wpa2()), ap("Home", "42:00:00:00:00:02", wpa2())]);
        let (_, real, copies) = wifi_view(&sv, None, &BTreeMap::new());
        assert_eq!((real.len(), copies.len()), (2, 0));
    }

    #[test]
    fn an_extender_on_your_network_repeating_your_name_is_not_a_copy() {
        let mut devices = BTreeMap::new();
        devices.insert("ext".into(), device("ext", "02:77:66:55:44:33", "10.9.8.3"));
        let sv = survey(Some(("Home", "40:00:00:00:00:01")), vec![ap("Home", "40:00:00:00:00:01", wpa2()), ap("Home", "0a:77:66:55:44:33", wpa2())]);
        let (_, _, copies) = wifi_view(&sv, None, &devices);
        assert!(copies.is_empty());
    }

    #[test]
    fn a_lookalike_name_with_an_invisible_character_still_counts_as_a_copy() {
        let sv = survey(Some(("Home", "40:00:00:00:00:01")), vec![ap("Home", "40:00:00:00:00:01", wpa2()), ap("Home\u{200b}", "9a:12:34:56:78:9a", open())]);
        let (_, _, copies) = wifi_view(&sv, None, &BTreeMap::new());
        assert_eq!(copies.len(), 1);
    }

    #[test]
    fn when_not_connected_a_weaker_copy_cannot_pass_as_the_real_network() {
        let sv = survey(None, vec![ap("Home", "9a:12:34:56:78:9a", open()), ap("Home", "40:00:00:00:00:01", wpa2())]);
        let (_, real, copies) = wifi_view(&sv, Some("Home"), &BTreeMap::new());
        assert_eq!(real[0].bssid, "40:00:00:00:00:01");
        assert_eq!(copies[0].bssid, "9a:12:34:56:78:9a");
    }

    #[test]
    fn copy_alerts_fire_once_per_copy_and_not_during_the_first_look() {
        let real = vec![ap("Home", "40:00:00:00:00:01", wpa2())];
        let copies = vec![ap("Home", "9a:12:34:56:78:9a", open())];
        let mut s = State::default();
        let mut alerts = Vec::new();
        copy_alerts(&mut s, &real, &copies, &mut alerts);
        s.baseline_done = true;
        copy_alerts(&mut s, &real, &copies, &mut alerts);
        assert!(alerts.is_empty());
    }

    #[test]
    fn missing_pmf_is_reported_for_a_wpa2_network() {
        let real = vec![ap("Home", "40:00:00:00:00:01", wpa2())];
        let v = WifiView { home_ssid: Some("Home".into()), ..Default::default() };
        let mut out = Vec::new();
        wifi_findings(&v, &real, &[], &mut out);
        assert!(out.iter().any(|f| f.id == "PL-NO-PMF"));
    }

    #[test]
    fn pmf_capable_networks_are_not_reported() {
        let real = vec![ap("Home", "40:00:00:00:00:01", Security { pmf_capable: true, ..wpa2() })];
        let v = WifiView { home_ssid: Some("Home".into()), ..Default::default() };
        let mut out = Vec::new();
        wifi_findings(&v, &real, &[], &mut out);
        assert!(!out.iter().any(|f| f.id == "PL-NO-PMF"));
    }

    #[test]
    fn saved_open_networks_that_auto_join_are_reported() {
        let saved = SavedNetwork { name: "Cafe".into(), ssid: "Cafe".into(), auto_connect: true, open: true, hidden: false, authentication: "open".into() };
        let v = WifiView { home_ssid: Some("Home".into()), saved_open_auto: vec![saved], ..Default::default() };
        let mut out = Vec::new();
        wifi_findings(&v, &[], &[], &mut out);
        assert!(out.iter().any(|f| f.id == "PL-SAVED-OPEN"));
    }

    // ---------- device doors ----------
    #[test]
    fn telnet_forwarded_to_the_internet_is_rated_high() {
        let mut d = device("k", "02:aa:bb:cc:dd:01", "10.9.8.5");
        d.deep = Some(DeepResult { ports: vec![23], ..Default::default() });
        let maps = vec![Mapping { external_port: 2323, internal_client: "10.9.8.5".into(), internal_port: 23, protocol: "TCP".into(), description: String::new() }];
        let mut out = Vec::new();
        device_findings(&d, &maps, &mut out);
        assert!(out[0].likely.starts_with("High"));
    }

    #[test]
    fn an_rtsp_port_makes_a_device_a_camera() {
        let mut d = device("k", "02:aa:bb:cc:dd:01", "10.9.8.5");
        d.deep = Some(DeepResult { ports: vec![554], ..Default::default() });
        assert_eq!(kind_of(&d), "camera");
    }

    #[test]
    fn a_named_phone_behind_the_extender_is_still_a_phone() {
        let d = Device { behind_repeater: true, router_name: Some("Galaxy-A54".into()), ..Default::default() };
        assert_eq!(kind_of(&d), "phone or tablet");
    }

    #[test]
    fn a_silent_device_behind_the_extender_says_where_it_is() {
        let d = Device { behind_repeater: true, ..Default::default() };
        assert_eq!(kind_of(&d), "device on your extender");
    }

    #[test]
    fn a_silent_device_answering_like_windows_is_a_windows_computer() {
        let d = Device { ttl: Some(128), private_mac: true, ..Default::default() };
        assert_eq!(kind_of(&d), "Windows computer");
    }

    #[test]
    fn a_silent_device_answering_like_a_phone_is_labelled_so_even_behind_the_extender() {
        let d = Device { ttl: Some(64), behind_repeater: true, ..Default::default() };
        assert_eq!(kind_of(&d), "phone, tablet or Mac");
    }

    #[test]
    fn this_computer_on_another_connection_is_not_a_new_device() {
        let me = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "TESTPC".into());
        let mut s = watched();
        s.devices.insert("k".into(), Device { router_name: Some(me), ..device("k", "02:aa:bb:cc:dd:01", "10.9.8.8") });
        let mut alerts = Vec::new();
        new_device_alerts(&mut s, &["k".into()], &mut alerts);
        assert!(alerts.is_empty() || std::env::var("COMPUTERNAME").is_err());
    }

    #[test]
    fn a_device_broadcasting_wifi_is_an_extender() {
        let mut d = device("k", "02:aa:bb:cc:dd:01", "10.9.8.5");
        d.broadcasts = vec!["Home-EXT".into()];
        assert_eq!(kind_of(&d), "Wi-Fi extender");
    }

    #[test]
    fn names_prefer_what_the_user_chose() {
        let mut d = Device { kind: "device".into(), vendor: Some("Apple".into()), ..Default::default() };
        assert_eq!(name_of(&d), "Apple device");
        d.detected_name = Some("Saras-iPhone".into());
        assert_eq!(name_of(&d), "Saras-iPhone");
        d.custom_name = Some("Mum's phone".into());
        assert_eq!(name_of(&d), "Mum's phone");
    }

    #[test]
    fn problems_the_user_accepted_dont_count() {
        let mut s = watched();
        s.accepted.push("PL-TELNET|k".into());
        assert_eq!(score_with(&[telnet()], &s.accepted), 100);
        let mut alerts = Vec::new();
        risk_alerts(&mut s, &HashSet::new(), &[telnet()], &mut alerts);
        assert!(alerts.is_empty());
    }

    #[test]
    fn an_answer_given_during_a_check_is_kept() {
        let mut work = watched();
        work.devices.insert("k".into(), device("k", "02:aa:bb:cc:dd:01", "10.9.8.5"));
        let mut live = work.clone();
        live.devices.get_mut("k").unwrap().owner = Some(true);
        live.accepted.push("PL-FTP|router".into());
        keep_user_changes(&mut work, &live, 100);
        assert_eq!((work.devices["k"].owner, work.accepted.len()), (Some(true), 1));
    }

    #[test]
    fn score_counts_only_problems() {
        let fs = vec![Finding { level: "worth-fixing".into(), ..Default::default() }, Finding { level: "good-to-know".into(), ..Default::default() }];
        assert_eq!(score(&fs), 90);
    }

    // ---------- kick-off attacks ----------
    #[test]
    fn three_quick_bounces_look_like_a_kick_off_attack() {
        let mut k = KickWatch::default();
        let mut hits = Vec::new();
        for t in [0u64, 60, 120] {
            k.disconnected("Home", t);
            hits.push(k.connected("Home", t + 5));
        }
        assert_eq!(hits, vec![None, None, Some(3)]);
    }

    #[test]
    fn a_slow_reconnect_is_not_a_bounce() {
        let mut k = KickWatch::default();
        for t in [0u64, 200, 400] {
            k.disconnected("Home", t);
            assert_eq!(k.connected("Home", t + BOUNCE_GAP + 1), None);
        }
    }

    #[test]
    fn bounces_spread_over_more_than_five_minutes_do_not_count() {
        let mut k = KickWatch::default();
        let mut hits = Vec::new();
        for t in [0u64, 400, 800] {
            k.disconnected("Home", t);
            hits.push(k.connected("Home", t + 5));
        }
        assert!(hits.iter().all(Option::is_none));
    }

    #[test]
    fn joining_a_different_network_is_not_a_bounce() {
        let mut k = KickWatch::default();
        for t in [0u64, 60, 120] {
            k.disconnected("Home", t);
            assert_eq!(k.connected("Cafe", t + 5), None);
        }
    }

    #[test]
    fn a_kick_off_alert_is_not_repeated_within_half_an_hour() {
        let mut k = KickWatch::default();
        let mut hits = 0;
        for i in 0..10u64 {
            k.disconnected("Home", i * 30);
            hits += usize::from(k.connected("Home", i * 30 + 5).is_some());
        }
        assert_eq!(hits, 1);
    }

    #[test]
    fn no_kick_off_alert_with_a_weak_signal() {
        assert!(kicked_off(&mut watched(), "Home", 3, 20).is_none());
    }

    #[test]
    fn the_kick_off_alert_points_at_missing_pmf() {
        let mut s = watched();
        s.findings.push(Finding { id: "PL-NO-PMF".into(), ..Default::default() });
        let a = kicked_off(&mut s, "Home", 3, 80).unwrap();
        assert!(a.body.contains("Protected Management Frames"));
    }

    // ---------- merging a finished check with what happened meanwhile ----------
    #[test]
    fn a_name_given_during_a_check_is_kept() {
        let mut work = watched();
        work.devices.insert("k".into(), Device { name: "Apple device".into(), ..device("k", "02:aa:bb:cc:dd:01", "10.9.8.5") });
        let mut live = work.clone();
        live.devices.get_mut("k").unwrap().custom_name = Some("Sara's laptop".into());
        keep_user_changes(&mut work, &live, 100);
        assert_eq!(work.devices["k"].name, "Sara's laptop");
    }

    #[test]
    fn an_alert_raised_during_a_check_is_kept() {
        let mut work = watched();
        let mut live = work.clone();
        live.alerts.push(Alert { id: 1, at: 150, title: "Something keeps kicking this computer off".into(), ..Default::default() });
        keep_user_changes(&mut work, &live, 100);
        assert_eq!(work.alerts.len(), 1);
    }

    #[test]
    fn alerts_read_during_a_check_stay_read() {
        let mut work = watched();
        work.alerts.push(Alert { id: 4, at: 50, ..Default::default() });
        let mut live = work.clone();
        live.alerts[0].read = true;
        keep_user_changes(&mut work, &live, 100);
        assert!(work.alerts[0].read);
    }

    #[test]
    fn a_device_removed_during_a_check_stays_removed() {
        let mut work = watched();
        work.last_check = 200;
        work.devices.insert("gone".into(), Device { last_seen: 90, ..device("gone", "02:aa:bb:cc:dd:02", "10.9.8.6") });
        let live = watched();
        keep_user_changes(&mut work, &live, 100);
        assert!(!work.devices.contains_key("gone"));
    }

    // ---------- DNS ----------
    #[test]
    fn dns_order_changes_are_not_a_change() {
        assert!(!dns_changed(&["10.9.8.1".into(), "1.1.1.1".into()], &["1.1.1.1".into(), "10.9.8.1".into()]));
    }

    #[test]
    fn new_dns_servers_alert_once_after_the_baseline() {
        let mut s = watched();
        let mut alerts = Vec::new();
        watch_dns(&mut s, &["10.9.8.1".into()], &mut alerts);
        watch_dns(&mut s, &["203.0.113.9".into()], &mut alerts);
        watch_dns(&mut s, &["203.0.113.9".into()], &mut alerts);
        assert_eq!(alerts.len(), 1);
        assert!(alerts[0].body.contains("203.0.113.9"));
    }

    #[test]
    fn findings_are_sorted_most_urgent_first() {
        let mut s = watched();
        s.mappings = vec![Mapping { external_port: 8080, internal_client: "10.9.8.5".into(), internal_port: 8080, protocol: "TCP".into(), description: String::new() }];
        let tip = Finding { id: "PL-X".into(), level: "good-to-know".into(), ..Default::default() };
        let out = all_findings(&s, &[], &[], vec![tip]);
        assert_eq!(out.iter().map(|f| f.level.as_str()).collect::<Vec<_>>(), vec!["fix-soon", "good-to-know"]);
    }
}
