//! Wi-Fi, through the Windows Wi-Fi API (no admin rights, nothing sent): which networks are around and how they're
//! protected (from the beacons access points broadcast to everyone), the network this computer is connected to,
//! and the networks this computer has saved and will join on its own.

use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::ptr;

#[link(name = "wlanapi")]
extern "system" {
    fn WlanOpenHandle(version: u32, reserved: *const c_void, negotiated: *mut u32, handle: *mut isize) -> u32;
    fn WlanCloseHandle(handle: isize, reserved: *const c_void) -> u32;
    fn WlanEnumInterfaces(handle: isize, reserved: *const c_void, list: *mut *mut u8) -> u32;
    fn WlanScan(handle: isize, guid: *const u8, ssid: *const c_void, ie: *const c_void, reserved: *const c_void) -> u32;
    fn WlanGetNetworkBssList(handle: isize, guid: *const u8, ssid: *const c_void, bss_type: u32, security: i32, reserved: *const c_void, list: *mut *mut u8) -> u32;
    fn WlanQueryInterface(handle: isize, guid: *const u8, opcode: u32, reserved: *const c_void, size: *mut u32, data: *mut *mut u8, value_type: *mut u32) -> u32;
    fn WlanGetProfileList(handle: isize, guid: *const u8, reserved: *const c_void, list: *mut *mut u8) -> u32;
    fn WlanGetProfile(handle: isize, guid: *const u8, name: *const u16, reserved: *const c_void, xml: *mut *mut u16, flags: *mut u32, access: *mut u32) -> u32;
    fn WlanFreeMemory(memory: *const c_void);
    fn WlanRegisterNotification(handle: isize, source: u32, ignore_duplicate: i32, callback: Option<unsafe extern "system" fn(*const Note, *mut c_void)>, context: *const c_void, reserved: *const c_void, previous: *mut u32) -> u32;
}

// Layouts of the Wi-Fi API's structures (x64), read by offset.
const IFACE_SIZE: usize = 532; // WLAN_INTERFACE_INFO
const BSS_SIZE: usize = 360; // WLAN_BSS_ENTRY
const PROFILE_SIZE: usize = 516; // WLAN_PROFILE_INFO

unsafe fn read_u32(p: *const u8, off: usize) -> u32 {
    ptr::read_unaligned(p.add(off) as *const u32)
}
unsafe fn read_utf16z(p: *const u8, off: usize, max_chars: usize) -> String {
    let w = p.add(off) as *const u16;
    let mut v = Vec::new();
    for i in 0..max_chars {
        let c = ptr::read_unaligned(w.add(i));
        if c == 0 {
            break;
        }
        v.push(c);
    }
    String::from_utf16_lossy(&v)
}

struct Wlan(isize);
impl Wlan {
    fn open() -> Option<Self> {
        let mut neg = 0u32;
        let mut h = 0isize;
        // SAFETY: out-pointers are valid locals.
        let rc = unsafe { WlanOpenHandle(2, ptr::null(), &mut neg, &mut h) };
        (rc == 0).then_some(Wlan(h))
    }
    fn interfaces(&self) -> Vec<([u8; 16], String, bool)> {
        let mut list: *mut u8 = ptr::null_mut();
        // SAFETY: the API allocates `list`; we read within the count it reports, then free it.
        unsafe {
            if WlanEnumInterfaces(self.0, ptr::null(), &mut list) != 0 || list.is_null() {
                return Vec::new();
            }
            let n = read_u32(list, 0) as usize;
            let out = (0..n)
                .map(|i| {
                    let e = list.add(8 + i * IFACE_SIZE);
                    let mut guid = [0u8; 16];
                    ptr::copy_nonoverlapping(e, guid.as_mut_ptr(), 16);
                    (guid, read_utf16z(e, 16, 256), read_u32(e, 528) == 1)
                })
                .collect();
            WlanFreeMemory(list as *const c_void);
            out
        }
    }
}
impl Drop for Wlan {
    fn drop(&mut self) {
        // SAFETY: the handle came from WlanOpenHandle.
        unsafe { WlanCloseHandle(self.0, ptr::null()) };
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Security {
    pub akms: Vec<String>,
    pub ciphers: Vec<String>,
    pub wpa1: bool,
    pub privacy: bool,
    /// Management frame protection (802.11w): capable / required. It's what stops "kick-off" (deauth) attacks.
    pub pmf_capable: bool,
    pub pmf_required: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Wps {
    pub configured: bool,
    pub locked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccessPoint {
    pub ssid: String,
    pub bssid: String,
    pub rssi: i32,
    pub security: Security,
    pub wps: Option<Wps>,
}

const AKM: [(u8, &str); 9] = [(1, "802.1X"), (2, "PSK"), (5, "802.1X"), (6, "PSK"), (8, "SAE"), (12, "802.1X"), (18, "OWE"), (24, "SAE"), (25, "SAE")];
const CIPHER: [(u8, &str); 6] = [(1, "WEP"), (2, "TKIP"), (4, "CCMP"), (5, "WEP"), (8, "GCMP"), (9, "GCMP")];

/// Group cipher, pairwise ciphers, AKMs, then (RSN only) the capabilities word with the PMF bits.
fn parse_suites(b: &[u8], start: usize, sec: &mut Security, rsn: bool) {
    let mut o = start + 4;
    let read16 = |o: usize| b.get(o..o + 2).map(|x| u16::from_le_bytes([x[0], x[1]]) as usize);
    let Some(pc) = read16(o) else { return };
    o += 2;
    for _ in 0..pc {
        if let Some(&t) = b.get(o + 3) {
            sec.ciphers.push(CIPHER.iter().find(|c| c.0 == t).map_or("other", |c| c.1).to_string());
        }
        o += 4;
    }
    let Some(ac) = read16(o) else { return };
    o += 2;
    for _ in 0..ac {
        if let Some(&t) = b.get(o + 3) {
            sec.akms.push(AKM.iter().find(|a| a.0 == t).map_or("other", |a| a.1).to_string());
        }
        o += 4;
    }
    if rsn {
        if let Some(cap) = read16(o) {
            sec.pmf_required = cap & 0x40 != 0;
            sec.pmf_capable = cap & 0x80 != 0;
        }
    }
}

fn parse_wps(body: &[u8]) -> Wps {
    let mut w = Wps::default();
    let mut j = 4;
    while j + 4 <= body.len() {
        let t = u16::from_be_bytes([body[j], body[j + 1]]);
        let l = usize::from(u16::from_be_bytes([body[j + 2], body[j + 3]]));
        let v = body.get(j + 4..j + 4 + l).unwrap_or(&[]);
        match t {
            0x1044 => w.configured = v.first() == Some(&2),
            0x1057 => w.locked = v.first() == Some(&1),
            _ => {}
        }
        j += 4 + l;
    }
    w
}

/// Reads the information elements of a beacon.
pub fn parse_ies(ies: &[u8], capability: u16) -> (Security, Option<Wps>) {
    let mut sec = Security { privacy: capability & 0x10 != 0, ..Default::default() };
    let mut wps = None;
    let mut i = 0;
    while i + 2 <= ies.len() {
        let id = ies[i];
        let len = usize::from(ies[i + 1]);
        let body = ies.get(i + 2..i + 2 + len).unwrap_or(&[]);
        if id == 48 && body.len() >= 2 {
            parse_suites(body, 2, &mut sec, true);
        } else if id == 221 && body.len() >= 4 {
            match body[..4] {
                [0x00, 0x50, 0xf2, 0x01] => {
                    sec.wpa1 = true;
                    if sec.akms.is_empty() {
                        parse_suites(body, 6, &mut sec, false);
                    }
                }
                [0x00, 0x50, 0xf2, 0x04] => wps = Some(parse_wps(body)),
                _ => {}
            }
        }
        i += 2 + len;
    }
    (sec, wps)
}

/// "WPA3", "WPA2/WPA3", "WPA2", "WPA2 (old TKIP)", "WPA", "WEP", "Open".
pub fn protection(sec: &Security) -> &'static str {
    let has = |a: &str| sec.akms.iter().any(|x| x == a);
    if has("SAE") && !has("PSK") {
        "WPA3"
    } else if has("SAE") {
        "WPA2/WPA3"
    } else if has("PSK") || has("802.1X") {
        if sec.wpa1 && sec.ciphers.iter().all(|c| c == "TKIP") {
            "WPA"
        } else if sec.ciphers.iter().all(|c| c == "TKIP") && !sec.ciphers.is_empty() {
            "WPA2 (old TKIP)"
        } else {
            "WPA2"
        }
    } else if has("OWE") {
        "Open (encrypted)"
    } else if sec.privacy {
        "WEP"
    } else {
        "Open"
    }
}

pub fn strength(p: &str) -> i32 {
    match p {
        "WPA3" | "WPA2/WPA3" => 5,
        "WPA2" => 4,
        "WPA2 (old TKIP)" => 3,
        "WPA" => 2,
        "WEP" => 1,
        "Open" | "Open (encrypted)" => 0,
        _ => -1,
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Connection {
    pub ssid: String,
    pub bssid: String,
    /// Signal quality, 0 to 100.
    pub quality: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedNetwork {
    pub name: String,
    pub ssid: String,
    pub auto_connect: bool,
    pub open: bool,
    pub hidden: bool,
    pub authentication: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Survey {
    pub adapters: Vec<String>,
    pub connected: Option<Connection>,
    pub aps: Vec<AccessPoint>,
    pub saved: Vec<SavedNetwork>,
}

fn tag(xml: &str, t: &str) -> String {
    crate::names::xml_tag(xml, t).unwrap_or_default()
}

pub fn parse_profile(xml: &str) -> SavedNetwork {
    let ssid_block = xml.split("<SSID>").nth(1).unwrap_or("");
    let auth = tag(xml, "authentication");
    SavedNetwork {
        name: tag(xml, "name"),
        ssid: tag(ssid_block, "name"),
        auto_connect: tag(xml, "connectionMode") != "manual",
        open: auth.eq_ignore_ascii_case("open") && tag(xml, "encryption").eq_ignore_ascii_case("none"),
        hidden: tag(xml, "nonBroadcast") == "true",
        authentication: auth,
    }
}

/// The access points one adapter currently knows about.
fn read_bss(w: &Wlan, guid: &[u8; 16]) -> Vec<AccessPoint> {
    let mut out = Vec::new();
    let mut list: *mut u8 = ptr::null_mut();
    // SAFETY: the API allocates `list`; entries are read within the count it reports, then freed.
    unsafe {
        if WlanGetNetworkBssList(w.0, guid.as_ptr(), ptr::null(), 3, 0, ptr::null(), &mut list) != 0 || list.is_null() {
            return out;
        }
        // Never read past the buffer Windows handed back, even if an entry claims otherwise.
        let total = read_u32(list, 0) as usize;
        let n = read_u32(list, 4) as usize;
        for i in 0..n {
            let start = 8 + i * BSS_SIZE;
            if start + BSS_SIZE > total {
                crate::log_warn!("Wi-Fi list shorter than its count ({total} bytes, {n} entries)");
                break;
            }
            let e = list.add(start);
            let len = (read_u32(e, 0) as usize).min(32);
            let ssid = String::from_utf8_lossy(std::slice::from_raw_parts(e.add(4), len)).into_owned();
            let mac = std::slice::from_raw_parts(e.add(40), 6);
            let bssid = mac.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":");
            let rssi = read_u32(e, 56) as i32;
            let cap = ptr::read_unaligned(e.add(88) as *const u16);
            let off = read_u32(e, 352) as usize;
            let size = (read_u32(e, 356) as usize).min(8192);
            let ies = if start + off + size <= total { std::slice::from_raw_parts(e.add(off), size) } else { &[][..] };
            let (security, wps) = parse_ies(ies, cap);
            out.push(AccessPoint { ssid, bssid, rssi, security, wps });
        }
        WlanFreeMemory(list as *const c_void);
    }
    out
}

/// Everything the Wi-Fi API can tell us. `fresh` asks the adapters for a new scan first. Windows empties the list
/// while a scan runs, so we keep what it already knew and merge in the fresh results once they arrive (up to 10 s).
pub fn survey(fresh: bool) -> Survey {
    let mut out = Survey::default();
    let Some(w) = Wlan::open() else { return out };
    let ifaces = w.interfaces();
    let mut by_bssid: std::collections::BTreeMap<String, AccessPoint> = std::collections::BTreeMap::new();
    for (guid, _, _) in &ifaces {
        for ap in read_bss(&w, guid) {
            by_bssid.insert(ap.bssid.clone(), ap);
        }
    }
    if fresh && !ifaces.is_empty() {
        for (guid, _, _) in &ifaces {
            // SAFETY: valid handle and interface GUID; the other parameters are optional.
            unsafe { WlanScan(w.0, guid.as_ptr(), ptr::null(), ptr::null(), ptr::null()) };
        }
        let start = std::time::Instant::now();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        loop {
            let found: Vec<AccessPoint> = ifaces.iter().flat_map(|(g, _, _)| read_bss(&w, g)).collect();
            if !found.is_empty() || start.elapsed() > std::time::Duration::from_secs(10) {
                for ap in found {
                    by_bssid.insert(ap.bssid.clone(), ap);
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
    out.aps = by_bssid.into_values().collect();
    for (guid, desc, connected) in &ifaces {
        out.adapters.push(desc.clone());
        // SAFETY (whole block): every pointer comes from the Wi-Fi API, is read within the sizes it reports, and is
        // released with WlanFreeMemory.
        unsafe {
            if *connected {
                let (mut size, mut data, mut vt) = (0u32, ptr::null_mut::<u8>(), 0u32);
                if WlanQueryInterface(w.0, guid.as_ptr(), 7, ptr::null(), &mut size, &mut data, &mut vt) == 0 && !data.is_null() && size >= 580 {
                    let len = (read_u32(data, 520) as usize).min(32);
                    let ssid = String::from_utf8_lossy(std::slice::from_raw_parts(data.add(524), len)).into_owned();
                    let b = std::slice::from_raw_parts(data.add(560), 6);
                    let bssid = b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":");
                    out.connected = Some(Connection { ssid, bssid, quality: read_u32(data, 576).min(100) });
                    WlanFreeMemory(data as *const c_void);
                }
            }
            let mut profiles: *mut u8 = ptr::null_mut();
            if out.saved.is_empty() && WlanGetProfileList(w.0, guid.as_ptr(), ptr::null(), &mut profiles) == 0 && !profiles.is_null() {
                let n = read_u32(profiles, 0) as usize;
                for i in 0..n {
                    let e = profiles.add(8 + i * PROFILE_SIZE);
                    let name: Vec<u16> = (0..256).map(|k| ptr::read_unaligned((e as *const u16).add(k))).take_while(|c| *c != 0).chain(std::iter::once(0)).collect();
                    let (mut xml, mut flags, mut access) = (ptr::null_mut::<u16>(), 0u32, 0u32);
                    if WlanGetProfile(w.0, guid.as_ptr(), name.as_ptr(), ptr::null(), &mut xml, &mut flags, &mut access) == 0 && !xml.is_null() {
                        let text = read_utf16z(xml as *const u8, 0, 1 << 16);
                        out.saved.push(parse_profile(&text));
                        WlanFreeMemory(xml as *const c_void);
                    }
                }
                WlanFreeMemory(profiles as *const c_void);
            }
        }
    }
    out
}

// ---------- live connection events, for spotting "kick-off" (deauthentication) attacks ----------

/// WLAN_NOTIFICATION_DATA (x64).
#[repr(C)]
pub struct Note {
    source: u32,
    code: u32,
    guid: [u8; 16],
    size: u32,
    data: *const u8,
}

const SOURCE_ACM: u32 = 0x8;
const ACM_CONNECTION_COMPLETE: u32 = 10;
const ACM_DISCONNECTED: u32 = 21;

/// What the Wi-Fi adapter just did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    Connected(String),
    Disconnected { ssid: String, reason: u32 },
}

static LINKS: std::sync::OnceLock<std::sync::Mutex<std::sync::mpsc::Sender<Link>>> = std::sync::OnceLock::new();

/// Reads a WLAN_CONNECTION_NOTIFICATION_DATA: mode @0, profile name @4, SSID length @516 and bytes @520,
/// reason code @560.
fn link_event(code: u32, data: &[u8]) -> Option<Link> {
    if data.len() < 564 {
        return None;
    }
    let u32_at = |o: usize| u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
    let len = (u32_at(516) as usize).min(32);
    let ssid = String::from_utf8_lossy(&data[520..520 + len]).into_owned();
    match code {
        ACM_CONNECTION_COMPLETE => Some(Link::Connected(ssid)),
        ACM_DISCONNECTED => Some(Link::Disconnected { ssid, reason: u32_at(560) }),
        _ => None,
    }
}

unsafe extern "system" fn on_note(note: *const Note, _context: *mut c_void) {
    // SAFETY: Windows passes a valid notification for the duration of the call, and `data` holds `size` bytes.
    let Some(n) = (unsafe { note.as_ref() }) else { return };
    if n.source != SOURCE_ACM || n.data.is_null() {
        return;
    }
    let data = unsafe { std::slice::from_raw_parts(n.data, n.size as usize) };
    if let (Some(ev), Some(tx)) = (link_event(n.code, data), LINKS.get()) {
        if let Ok(tx) = tx.lock() {
            let _ = tx.send(ev);
        }
    }
}

/// Keeps a Wi-Fi handle open so connection events keep arriving; they stop when this is dropped.
pub struct LinkWatch {
    _handle: Wlan,
}

/// Starts sending connection events to `tx`. One watcher per app.
pub fn watch_links(tx: std::sync::mpsc::Sender<Link>) -> Option<LinkWatch> {
    LINKS.set(std::sync::Mutex::new(tx)).ok()?;
    let w = Wlan::open()?;
    let mut previous = 0u32;
    // SAFETY: the callback only reads the data Windows passes it, and the handle stays open as long as the
    // returned LinkWatch lives.
    let rc = unsafe { WlanRegisterNotification(w.0, SOURCE_ACM, 1, Some(on_note), ptr::null(), ptr::null(), &mut previous) };
    if rc != 0 {
        crate::log_warn!("Wi-Fi events unavailable (WlanRegisterNotification returned {rc})");
        return None;
    }
    Some(LinkWatch { _handle: w })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(ssid: &str, reason: u32) -> Vec<u8> {
        let mut d = vec![0u8; 568];
        d[516..520].copy_from_slice(&(ssid.len() as u32).to_le_bytes());
        d[520..520 + ssid.len()].copy_from_slice(ssid.as_bytes());
        d[560..564].copy_from_slice(&reason.to_le_bytes());
        d
    }

    #[test]
    fn connection_events_carry_the_network_name() {
        assert_eq!(link_event(10, &note("Home", 0)), Some(Link::Connected("Home".into())));
        assert_eq!(link_event(21, &note("Home", 0x8_0008)), Some(Link::Disconnected { ssid: "Home".into(), reason: 0x8_0008 }));
    }

    #[test]
    fn other_events_and_short_buffers_are_ignored() {
        assert_eq!(link_event(7, &note("Home", 0)), None);
        assert_eq!(link_event(21, &[0u8; 100]), None);
    }

    fn rsn(pmf: u16) -> Vec<u8> {
        let mut b = vec![48, 20, 1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 2];
        b.extend_from_slice(&pmf.to_le_bytes());
        b
    }

    #[test]
    fn reads_wpa2_and_pmf_bits() {
        let (sec, wps) = parse_ies(&rsn(0x80), 0x0411);
        assert_eq!(protection(&sec), "WPA2");
        assert!(sec.pmf_capable && !sec.pmf_required);
        assert!(wps.is_none());
        let (sec, _) = parse_ies(&rsn(0xc0), 0x0411);
        assert!(sec.pmf_required);
    }

    #[test]
    fn reads_wps_and_open_networks() {
        let mut ies = rsn(0);
        ies.extend_from_slice(&[221, 14, 0x00, 0x50, 0xf2, 0x04, 0x10, 0x44, 0, 1, 2, 0x10, 0x57, 0, 1, 1]);
        let (_, wps) = parse_ies(&ies, 0x0411);
        assert_eq!(wps, Some(Wps { configured: true, locked: true }));
        let (open, _) = parse_ies(&[], 0x0401);
        assert_eq!(protection(&open), "Open");
        let (wep, _) = parse_ies(&[], 0x0411);
        assert_eq!(protection(&wep), "WEP");
    }

    #[test]
    fn reads_saved_profiles() {
        let xml = "<WLANProfile><name>Cafe Free</name><SSIDConfig><SSID><name>Cafe Free</name></SSID><nonBroadcast>false</nonBroadcast></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption></authEncryption></security></MSM></WLANProfile>";
        let p = parse_profile(xml);
        assert!(p.open && p.auto_connect && !p.hidden);
        assert_eq!(p.ssid, "Cafe Free");
    }
}

#[cfg(test)]
mod live {
    /// cargo test live_survey -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_survey() {
        let s = super::survey(true);
        println!("adapters {:?} connected {:?} saved {}", s.adapters, s.connected, s.saved.len());
        for a in &s.aps {
            println!("{:<18} {} {:<10} pmf={}/{} wps={:?}", a.ssid, a.bssid, super::protection(&a.security), a.security.pmf_capable, a.security.pmf_required, a.wps);
        }
    }
}
