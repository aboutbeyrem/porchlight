//! Naming devices: what each device says about itself (mDNS, NetBIOS, its web page, UPnP), the maker from the IEEE
//! registry, and whether it uses a private (randomised) address. Every query is one a device is built to answer.

use crate::net::{self, http_get, Network};
use std::collections::HashMap;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static OUI_TEXT: &str = include_str!("../../../data/oui.txt");

fn oui_table() -> &'static HashMap<u32, &'static str> {
    static TABLE: OnceLock<HashMap<u32, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| {
        OUI_TEXT
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| {
                let (k, v) = l.split_once('\t')?;
                Some((u32::from_str_radix(k, 16).ok()?, v))
            })
            .collect()
    })
}

/// Phones, tablets and laptops use a private, randomised address on Wi-Fi ("locally administered" bit set).
pub fn is_private_mac(mac: &[u8; 6]) -> bool {
    mac[0] & 0b11 == 0b10
}

pub fn vendor(mac: &[u8; 6]) -> Option<&'static str> {
    if is_private_mac(mac) {
        return None;
    }
    let key = (u32::from(mac[0]) << 16) | (u32::from(mac[1]) << 8) | u32::from(mac[2]);
    oui_table().get(&key).copied()
}

// ---------- DNS messages (mDNS) ----------
fn encode_query(name: &str, qtype: u16) -> Vec<u8> {
    let mut b = vec![0x50, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in name.split('.').filter(|l| !l.is_empty()) {
        b.push(label.len() as u8);
        b.extend_from_slice(label.as_bytes());
    }
    b.extend_from_slice(&[0, (qtype >> 8) as u8, qtype as u8, 0, 1]);
    b
}

fn read_name(buf: &[u8], mut off: usize) -> (String, usize) {
    let mut labels = Vec::new();
    let mut next = None;
    for _ in 0..64 {
        let Some(&len) = buf.get(off) else { break };
        if len == 0 {
            next.get_or_insert(off + 1);
            break;
        }
        if len & 0xc0 == 0xc0 {
            let Some(&lo) = buf.get(off + 1) else { break };
            next.get_or_insert(off + 2);
            off = (usize::from(len & 0x3f) << 8) | usize::from(lo);
            continue;
        }
        let end = off + 1 + usize::from(len);
        let Some(bytes) = buf.get(off + 1..end) else { break };
        labels.push(String::from_utf8_lossy(bytes).into_owned());
        off = end;
    }
    (labels.join("."), next.unwrap_or(off))
}

/// First PTR answer in a DNS reply.
pub fn ptr_answer(buf: &[u8]) -> Option<String> {
    if buf.len() < 12 {
        return None;
    }
    let qd = usize::from(u16::from_be_bytes([buf[4], buf[5]]));
    let an = usize::from(u16::from_be_bytes([buf[6], buf[7]])) + usize::from(u16::from_be_bytes([buf[8], buf[9]])) + usize::from(u16::from_be_bytes([buf[10], buf[11]]));
    let mut off = 12;
    for _ in 0..qd {
        off = read_name(buf, off).1 + 4;
    }
    for _ in 0..an {
        let (_, after) = read_name(buf, off);
        let rtype = u16::from_be_bytes([*buf.get(after)?, *buf.get(after + 1)?]);
        let len = usize::from(u16::from_be_bytes([*buf.get(after + 8)?, *buf.get(after + 9)?]));
        let start = after + 10;
        if rtype == 12 {
            return Some(read_name(buf, start).0);
        }
        off = start + len;
    }
    None
}

/// Asks a device directly for its own name (Apple devices, Linux, Windows 10+ answer this).
pub fn mdns_name(ip: Ipv4Addr) -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(900))).ok()?;
    let o = ip.octets();
    let name = format!("{}.{}.{}.{}.in-addr.arpa", o[3], o[2], o[1], o[0]);
    sock.send_to(&encode_query(&name, 12), (ip, 5353)).ok()?;
    let mut buf = [0u8; 1500];
    let (n, _) = sock.recv_from(&mut buf).ok()?;
    let host = ptr_answer(&buf[..n])?;
    let host = host.trim_end_matches(".local").trim_end_matches('.').to_string();
    (!host.is_empty()).then_some(host)
}

// ---------- NetBIOS: the name a Windows PC or storage drive gives itself ----------
const NBSTAT: [u8; 50] = [
    0x50, 0x43, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x43, 0x4b, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
    0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x00, 0x00, 0x21, 0x00, 0x01,
];

pub fn parse_nbstat(buf: &[u8]) -> Option<String> {
    let mut off = 12;
    while off < buf.len() && buf[off] != 0 {
        off += usize::from(buf[off]) + 1;
    }
    off += 1 + 2 + 2 + 4 + 2;
    let count = usize::from(*buf.get(off)?);
    off += 1;
    let mut fallback = None;
    for i in 0..count {
        let e = buf.get(off + i * 18..off + i * 18 + 18)?;
        let name = String::from_utf8_lossy(&e[..15]).trim_end().to_string();
        let group = e[16] & 0x80 != 0;
        if e[15] == 0x00 && !group {
            return Some(name);
        }
        if e[15] == 0x20 {
            fallback.get_or_insert(name);
        }
    }
    fallback
}

pub fn netbios_name(ip: Ipv4Addr) -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(900))).ok()?;
    sock.send_to(&NBSTAT, (ip, 137)).ok()?;
    let mut buf = [0u8; 1500];
    let (n, _) = sock.recv_from(&mut buf).ok()?;
    parse_nbstat(&buf[..n])
}

// ---------- A device's web page title ("PIX-LINK", "IPC-Living-Room") ----------
pub fn page_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let end = lower[open_end..].find("</title>")? + open_end;
    let t = html[open_end..end].replace("&amp;", "&").split_whitespace().collect::<Vec<_>>().join(" ");
    let t = t.trim_matches(|c: char| ".:|-_*~ ".contains(c)).to_string();
    let generic = ["login", "log in", "sign in", "index", "home", "welcome", "web", "untitled", "document", "redirect", "loading", "router", "default", "main", "configuration", "setup"];
    let low = t.to_ascii_lowercase();
    if t.chars().count() < 2 || generic.iter().any(|g| low.starts_with(g)) || low.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(t.chars().take(60).collect())
}

pub fn web_title(ip: Ipv4Addr) -> Option<String> {
    let mut path = "/".to_string();
    for _ in 0..3 {
        let (status, head, body) = http_get(ip, 80, &path)?;
        if (300..400).contains(&status) {
            let loc = net::header(&head, "location")?;
            // Only follow redirects on the same device: "/x", "http://ip/x" or "http://ip:80/x".
            path = if loc.starts_with('/') {
                loc.to_string()
            } else {
                let (h, p, rest) = parse_location(loc)?;
                if h != ip || p != 80 {
                    return None;
                }
                rest
            };
            continue;
        }
        return page_title(&body);
    }
    None
}

// ---------- UPnP (SSDP): devices describe themselves; the router says whether it opens ports by itself ----------
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Upnp {
    pub friendly_name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub igd_control: Option<(u16, String)>,
}

pub fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{tag}>"))? + start;
    let v = xml[start..end].trim().to_string();
    (!v.is_empty()).then_some(v)
}

fn parse_location(loc: &str) -> Option<(Ipv4Addr, u16, String)> {
    let rest = loc.strip_prefix("http://")?;
    let (hostport, path) = rest.split_once('/').map(|(h, p)| (h, format!("/{p}"))).unwrap_or((rest, "/".into()));
    let (host, port) = hostport.split_once(':').map(|(h, p)| (h, p.parse().unwrap_or(80))).unwrap_or((hostport, 80));
    Some((host.parse().ok()?, port, path))
}

pub fn ssdp(net: &Network) -> HashMap<Ipv4Addr, Upnp> {
    let mut locations: HashMap<String, Ipv4Addr> = HashMap::new();
    if let Ok(sock) = UdpSocket::bind((net.address, 0)) {
        let search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n";
        let _ = sock.send_to(search.as_bytes(), ("239.255.255.250", 1900));
        let _ = sock.send_to(search.as_bytes(), (net.gateway, 1900));
        let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));
        let until = Instant::now() + Duration::from_millis(2600);
        let mut buf = [0u8; 2048];
        while Instant::now() < until {
            if let Ok((n, from)) = sock.recv_from(&mut buf) {
                let text = String::from_utf8_lossy(&buf[..n]);
                if let (Some(loc), std::net::SocketAddr::V4(v4)) = (net::header(&text, "location"), from) {
                    locations.entry(loc.to_string()).or_insert(*v4.ip());
                }
            }
        }
    }
    let mut out: HashMap<Ipv4Addr, Upnp> = HashMap::new();
    for (loc, from) in locations {
        let Some((host, port, path)) = parse_location(&loc) else { continue };
        if host != from {
            continue;
        }
        let Some((200, _, xml)) = http_get(host, port, &path) else { continue };
        let entry = out.entry(host).or_default();
        if entry.friendly_name.is_none() {
            entry.friendly_name = xml_tag(&xml, "friendlyName");
            entry.manufacturer = xml_tag(&xml, "manufacturer");
            entry.model = xml_tag(&xml, "modelName");
        }
        for svc in xml.split("<service>").skip(1) {
            let ty = xml_tag(svc, "serviceType").unwrap_or_default();
            if ty.contains("WANIPConnection") || ty.contains("WANPPPConnection") {
                if let Some(ctl) = xml_tag(svc, "controlURL") {
                    let ctl = if ctl.starts_with('/') { ctl } else { format!("/{ctl}") };
                    entry.igd_control = Some((port, format!("{ctl}|{ty}")));
                }
            }
        }
    }
    out
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Mapping {
    pub external_port: u16,
    pub internal_client: String,
    pub internal_port: u16,
    pub protocol: String,
    pub description: String,
}

/// Lists (never changes) the ports devices asked the router to open to the internet.
pub fn list_mappings(router: Ipv4Addr, port: u16, control: &str) -> Vec<Mapping> {
    let (path, service) = control.split_once('|').unwrap_or((control, "urn:schemas-upnp-org:service:WANIPConnection:1"));
    let mut out = Vec::new();
    for i in 0..64 {
        let body = format!(
            "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetGenericPortMappingEntry xmlns:u=\"{service}\"><NewPortMappingIndex>{i}</NewPortMappingIndex></u:GetGenericPortMappingEntry></s:Body></s:Envelope>"
        );
        let action = format!("\"{service}#GetGenericPortMappingEntry\"");
        let Some((200, _, xml)) = net::http_request(router, port, "POST", path, &[("Content-Type", "text/xml; charset=\"utf-8\""), ("SOAPAction", &action)], &body) else { break };
        let get = |t: &str| xml_tag(&xml, t).unwrap_or_default();
        if get("NewEnabled") == "0" {
            continue;
        }
        out.push(Mapping {
            external_port: get("NewExternalPort").parse().unwrap_or(0),
            internal_client: get("NewInternalClient"),
            internal_port: get("NewInternalPort").parse().unwrap_or(0),
            protocol: get("NewProtocol"),
            description: get("NewPortMappingDescription"),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendor_lookup_uses_the_bundled_registry() {
        assert_eq!(vendor(&[0x00, 0xc0, 0xca, 1, 2, 3]), Some("ALFA"));
        assert_eq!(vendor(&[0x82, 0x91, 0x64, 1, 2, 3]), None, "private addresses have no maker");
    }

    #[test]
    fn titles_skip_generic_ones() {
        assert_eq!(page_title("<html><title> PIX-LINK </title>"), Some("PIX-LINK".into()));
        assert_eq!(page_title("<title>.::Welcome to the Web-Based Configurator::.</title>"), None);
        assert_eq!(page_title("<TITLE>Login</TITLE>"), None);
    }

    #[test]
    fn ptr_answers_decode() {
        // header (1 answer), answer name with a pointer-free label list, PTR to "sara-iphone.local"
        let mut b = vec![0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0];
        b.extend_from_slice(&[1, b'x', 0, 0, 12, 0, 1, 0, 0, 0, 120]);
        let target = [11, b's', b'a', b'r', b'a', b'-', b'i', b'p', b'h', b'o', b'n', b'e', 5, b'l', b'o', b'c', b'a', b'l', 0];
        b.extend_from_slice(&[0, target.len() as u8]);
        b.extend_from_slice(&target);
        assert_eq!(ptr_answer(&b), Some("sara-iphone.local".into()));
    }
}

#[cfg(test)]
mod live {
    /// Run with: cargo test live_ -- --ignored --nocapture (needs a device at PORCHLIGHT_TEST_IP)
    #[test]
    #[ignore]
    fn live_web_title() {
        let ip: std::net::Ipv4Addr = std::env::var("PORCHLIGHT_TEST_IP").unwrap_or_else(|_| "127.0.0.1".into()).parse().unwrap();
        let first = crate::net::http_get(ip, 80, "/");
        println!("first: {:?}", first.as_ref().map(|(s, h, b)| (s, h.len(), b.len())));
        if let Some((_, h, _)) = &first { println!("location: {:?}", crate::net::header(h, "location")); }
        println!("title: {:?}", super::web_title(ip));
    }
}
