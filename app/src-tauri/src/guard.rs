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
fn kind_of(d: &Device) -> String {
    if d.is_router {
        return "router".into();
    }
    if d.is_self {
        return "this computer".into();
    }
    let text = format!("{} {} {} {}", d.upnp_name.as_deref().unwrap_or(""), d.detected_name.as_deref().unwrap_or(""), d.web_title.as_deref().unwrap_or(""), d.vendor.as_deref().unwrap_or("")).to_lowercase();
    let ports = d.deep.as_ref().map(|x| x.ports.clone()).unwrap_or_default();
    let has = |w: &[&str]| w.iter().any(|x| text.contains(x));
    if has(&["camera", "ipc", "nvr", "dvr", "hikvision", "dahua", "reolink", "ezviz", "imou", "netcam"]) || ports.iter().any(|p| [554, 8554, 34567, 37777].contains(p)) {
        return "camera".into();
    }
    if !d.broadcasts.is_empty() || has(&["pix-link", "repeater", "extender", "mesh", "access point"]) {
        return "Wi-Fi extender".into();
    }
    if d.behind_repeater {
        return "device on your extender".into();
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
    if has(&["desktop-", "laptop-", "raspberry"]) || ports.contains(&3389) || ports.contains(&445) {
        return "computer".into();
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
    if let Some(n) = d.upnp_name.as_ref().or(d.detected_name.as_ref()).or(d.web_title.as_ref()) {
        return n.clone();
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

fn refresh_names(d: &mut Device, upnp: &HashMap<Ipv4Addr, Upnp>) {
    let Ok(ip) = d.ip.parse::<Ipv4Addr>() else { return };
    if let Some(u) = upnp.get(&ip) {
        d.upnp_name = u.friendly_name.clone().or(d.upnp_name.take());
    }
    if d.is_self {
        return;
    }
    if d.names_checked + 24 * 3600 < now() || d.detected_name.is_none() && d.names_checked == 0 {
        d.detected_name = names::mdns_name(ip).or_else(|| names::netbios_name(ip)).or(d.detected_name.take());
        d.web_title = names::web_title(ip).or(d.web_title.take());
        d.names_checked = now();
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

fn score(findings: &[Finding]) -> u32 {
    let cost: u32 = findings.iter().map(|f| match f.level.as_str() { "fix-soon" => 25, "worth-fixing" => 10, _ => 0 }).sum();
    100u32.saturating_sub(cost)
}

/// One check. `full` also knocks on each device's doors (on demand, daily, and for new devices).
/// Returns the alerts worth a notification.
pub fn check(state: &mut State, full: bool, progress: &dyn Fn(&str)) -> Vec<Alert> {
    let mut alerts = Vec::new();
    let t = now();
    progress("Finding your network");
    let Some(netw) = net::find_network() else {
        state.status = "Not connected to a network".into();
        state.on_home = false;
        state.last_check = t;
        return alerts;
    };
    if state.home.is_none() {
        state.home = Some(Home { cidr: netw.cidr.clone(), gateway: netw.gateway.to_string(), router_mac: None });
    }
    let home = state.home.clone().unwrap_or_default();
    state.on_home = home.cidr == netw.cidr && home.gateway == netw.gateway.to_string();
    state.network = Some(netw.clone());

    progress("Listening to your Wi-Fi");
    let survey = wifi::survey(true);

    if state.on_home {
        progress("Looking for devices");
        let found = net::sweep(&net::hosts(&netw));
        let upnp = names::ssdp(&netw);
        let mut mac_count: HashMap<[u8; 6], usize> = HashMap::new();
        for (_, m) in &found {
            *mac_count.entry(*m).or_default() += 1;
        }
        let gateway_mac = found.iter().find(|(ip, _)| *ip == netw.gateway).map(|(_, m)| mac_str(m));

        // Someone pretending to be the router (ARP spoofing), or the router's identity changing.
        if let Some(gm) = &gateway_mac {
            let impostors: Vec<String> = found.iter().filter(|(ip, m)| *ip != netw.gateway && mac_str(m) == *gm).map(|(ip, _)| ip.to_string()).collect();
            if !impostors.is_empty() && state.first_time(format!("spoof:{gm}:{}", impostors.join(","))) {
                alerts.push(state.alert("urgent", "Another device is answering as your router".into(),
                    format!("The device at {} uses the same hardware address as your router. That's how a \"man-in-the-middle\" attack starts: traffic meant for the router goes through that device first. Unplug or switch off devices you don't recognise, then restart your router.", impostors.join(", ")), None));
            }
            match state.home.as_mut().and_then(|h| h.router_mac.clone()) {
                None => {
                    if let Some(h) = state.home.as_mut() {
                        h.router_mac = Some(gm.clone());
                    }
                }
                Some(old) if &old != gm
                    && state.first_time(format!("router-changed:{gm}")) => {
                        alerts.push(state.alert("urgent", "Your router's identity changed".into(),
                            format!("Your router used to have the hardware address {old}; now something at the router's address answers with {gm}. If you didn't replace your router, another device may be pretending to be it. If you did, open Porchlight and tap \"I replaced my router\"."), None));
                    }
                _ => {}
            }
        }

        let seen_keys: HashSet<String> = found
            .iter()
            .map(|(ip, m)| if mac_count[m] > 1 { format!("{}@{ip}", mac_str(m)) } else { mac_str(m) })
            .collect();
        for d in state.devices.values_mut() {
            d.online = seen_keys.contains(&d.key) || d.is_self;
        }
        let mut new_devices = Vec::new();
        for (ip, m) in &found {
            let shared = mac_count[m] > 1;
            let key = if shared { format!("{}@{ip}", mac_str(m)) } else { mac_str(m) };
            let is_new = !state.devices.contains_key(&key);
            let d = state.devices.entry(key.clone()).or_insert_with(|| Device { key: key.clone(), first_seen: t, ..Default::default() });
            d.ip = ip.to_string();
            d.mac = mac_str(m);
            d.vendor = names::vendor(m).map(String::from);
            d.private_mac = names::is_private_mac(m);
            d.is_router = *ip == netw.gateway;
            d.behind_repeater = shared;
            d.last_seen = t;
            d.online = true;
            if is_new {
                new_devices.push(key);
            }
        }
        let me = state.devices.entry("self".into()).or_insert_with(|| Device { key: "self".into(), first_seen: t, is_self: true, ..Default::default() });
        me.ip = netw.address.to_string();
        me.is_self = true;
        me.online = true;
        me.last_seen = t;

        progress("Naming devices");
        let keys: Vec<String> = state.devices.keys().cloned().collect();
        for k in &keys {
            if let Some(d) = state.devices.get_mut(k) {
                if d.online {
                    refresh_names(d, &upnp);
                }
            }
        }
        // Repeaters: the device sharing its MAC with others that has its own page is the extender itself.
        for k in &keys {
            if let Some(d) = state.devices.get_mut(k) {
                if d.behind_repeater && d.web_title.is_some() {
                    d.behind_repeater = false;
                }
                d.broadcasts = survey.aps.iter().filter(|a| !d.behind_repeater && !d.is_self && !d.mac.is_empty() && same_hardware(&d.mac, &a.bssid)).map(|a| a.ssid.clone()).collect::<HashSet<_>>().into_iter().collect();
            }
        }

        // Doors: everything on a full check; otherwise just the newcomers.
        let deep_keys: Vec<String> = if full { keys.clone() } else { new_devices.clone() };
        if !deep_keys.is_empty() {
            progress(&format!("Checking {} device{} for open doors", deep_keys.len(), if deep_keys.len() == 1 { "" } else { "s" }));
            let jobs: Vec<(String, Ipv4Addr)> = deep_keys.iter().filter_map(|k| state.devices.get(k).filter(|d| d.online).and_then(|d| d.ip.parse().ok().map(|ip| (k.clone(), ip)))).collect();
            let results: Vec<(String, DeepResult)> = std::thread::scope(|s| {
                let handles: Vec<_> = jobs.iter().map(|(k, ip)| s.spawn(move || (k.clone(), checks::deep_check(*ip, t)))).collect();
                handles.into_iter().filter_map(|h| h.join().ok()).collect()
            });
            for (k, r) in results {
                if let Some(d) = state.devices.get_mut(&k) {
                    d.deep = Some(r);
                }
            }
            if full {
                state.last_full = t;
            }
        }
        // Doors devices opened to the internet through the router (UPnP), listed, never changed.
        state.upnp_on = Some(false);
        state.mappings.clear();
        if let Some(u) = upnp.get(&netw.gateway) {
            if let Some((port, ctl)) = &u.igd_control {
                state.upnp_on = Some(true);
                state.mappings = names::list_mappings(netw.gateway, *port, ctl);
            }
        }
        for k in &keys {
            if let Some(d) = state.devices.get_mut(k) {
                d.kind = kind_of(d);
                d.name = name_of(d);
            }
        }

        if state.baseline_done && state.settings.notify {
            for k in &new_devices {
                if let Some(d) = state.devices.get(k).cloned() {
                    let extra = d.deep.as_ref().filter(|x| !x.ports.is_empty()).map(|x| format!(" Open doors: {}.", x.ports.iter().map(|p| checks::port_name(*p)).collect::<Vec<_>>().join(", "))).unwrap_or_default();
                    alerts.push(state.alert("warning", format!("New device: {}", d.name), format!("{} joined your network.{extra} If you don't recognise it, change your Wi-Fi password.", if d.name.eq_ignore_ascii_case(&d.kind) { format!("A {} ({})", d.kind, d.ip) } else { format!("{} ({}, {})", d.name, d.kind, d.ip) }), Some(k.clone())));
                }
            }
        }
    }

    // Wi-Fi view and every finding, recomputed from what we know now.
    let (view, real, copies) = wifi_view(&survey, state.settings.home_ssid.as_deref(), &state.devices);
    state.wifi = view;
    for c in &copies {
        if wifi::strength(wifi::protection(&c.security)) < real.iter().map(|a| wifi::strength(wifi::protection(&a.security))).max().unwrap_or(-1) && state.first_time(format!("copy:{}", c.bssid)) && state.baseline_done {
            alerts.push(state.alert("urgent", format!("A fake copy of \"{}\" appeared", c.ssid), format!("An access point nearby broadcasts your Wi-Fi's name with {} protection. Don't connect to it; your devices should stay on your real network.", wifi::protection(&c.security)), None));
        }
    }
    let previous: HashSet<String> = state.findings.iter().map(|f| format!("{}|{}", f.id, f.device.clone().unwrap_or_default())).collect();
    let mut findings = Vec::new();
    for d in state.devices.values() {
        if d.online || d.is_router {
            device_findings(d, &state.mappings, &mut findings);
        }
    }
    wifi_findings(&state.wifi, &real, &copies, &mut findings);
    for m in &state.mappings {
        let name = state.devices.values().find(|d| d.ip == m.internal_client).map(|d| d.name.clone()).unwrap_or_else(|| m.internal_client.clone());
        let sensitive = [21, 23, 80, 554, 8000, 8080, 8554, 34567, 37777, 3389, 5900].contains(&m.internal_port);
        findings.push(Finding { id: "PL-UPNP-MAPPING".into(), level: if sensitive { "fix-soon" } else { "worth-fixing" }.into(), title: "A device opened a door to the internet by itself".into(),
            found: format!("{name} asked your router to open port {} ({}) to the internet{}.", m.external_port, m.protocol, if m.description.is_empty() { String::new() } else { format!(", labelled \"{}\"", m.description) }),
            means: "Anyone on the internet can now reach that device through this port, not just people in your home.".into(),
            likely: if sensitive { "High: internet-wide scanners look for exactly these services." } else { "Low to moderate, depending on what's listening." }.into(),
            fix: vec!["If you don't recognise it: in your router's settings, turn off UPnP, then restart the device.".into()], device: None });
    }
    let order = |l: &str| match l { "fix-soon" => 0, "worth-fixing" => 1, "good-to-know" => 2, _ => 3 };
    findings.sort_by_key(|f| order(&f.level));
    if state.baseline_done && state.settings.notify {
        for fnd in findings.iter().filter(|f| order(&f.level) <= 1) {
            let key = format!("{}|{}", fnd.id, fnd.device.clone().unwrap_or_default());
            if !previous.contains(&key) && fnd.id != "PL-EVIL-TWIN" && state.first_time(format!("finding:{key}")) {
                alerts.push(state.alert(if fnd.level == "fix-soon" { "urgent" } else { "warning" }, format!("New risk: {}", fnd.title), fnd.found.clone(), fnd.device.clone()));
            }
        }
    }
    state.score = score(&findings);
    state.findings = findings;
    state.last_check = t;
    state.status = if state.on_home { format!("Watching {} devices", state.devices.values().filter(|d| d.online).count()) } else { "You're on a different network; Porchlight watches your home network".into() };
    if !state.baseline_done && state.on_home {
        state.baseline_done = true;
        state.baseline_at = t;
        for f in &state.findings {
            let k = format!("finding:{}|{}", f.id, f.device.clone().unwrap_or_default());
            if !state.notified.contains(&k) {
                state.notified.push(k);
            }
        }
        alerts.push(state.alert("info", "Porchlight is watching your home".into(), format!("{} devices are on your network. You'll get a notification if a new one joins, if something pretends to be your router, or if a new risk appears.", state.devices.values().filter(|d| d.online).count()), None));
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radios_and_routers_are_matched() {
        assert!(same_hardware("82:3a:7c:10:5e:21", "90:3a:7c:10:5e:21"));
        assert!(same_router("4c:11:22:33:44:55", "4e:11:22:43:44:55"));
        assert!(!same_router("4c:11:22:33:44:55", "20:aa:bb:cc:dd:ee"));
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
    fn score_counts_only_problems() {
        let fs = vec![Finding { level: "worth-fixing".into(), ..Default::default() }, Finding { level: "good-to-know".into(), ..Default::default() }];
        assert_eq!(score(&fs), 90);
    }
}
