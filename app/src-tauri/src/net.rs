//! The local network: which one we're on, which devices answer, and small helpers for talking to them.
//! Everything here is read-only: an ARP request ("who has this address?"), a TCP connect that is closed straight
//! away, or a plain HTTP request for a device's own front page.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Hide the console window of helper commands (route).
pub const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Network {
    pub address: Ipv4Addr,
    pub gateway: Ipv4Addr,
    pub cidr: String,
}

pub fn run(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// Windows `route print -4 0.0.0.0`: "0.0.0.0  0.0.0.0  192.168.1.1  192.168.1.50  25" (gateway, interface, metric).
pub fn parse_default_route(text: &str) -> Option<(Ipv4Addr, Ipv4Addr)> {
    let mut best: Option<(u32, Ipv4Addr, Ipv4Addr)> = None;
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 && parts[0] == "0.0.0.0" && parts[1] == "0.0.0.0" {
            if let (Ok(gw), Ok(ip), Ok(metric)) = (parts[2].parse(), parts[3].parse(), parts[4].parse::<u32>()) {
                if best.map_or(true, |b| metric < b.0) {
                    best = Some((metric, gw, ip));
                }
            }
        }
    }
    best.map(|(_, gw, ip)| (gw, ip))
}

/// The network this computer reaches the internet through. Home networks are /24; larger ones are narrowed to the
/// /24 around this computer so a check stays quick and gentle.
pub fn find_network() -> Option<Network> {
    let (gateway, address) = parse_default_route(&run("route", &["print", "-4", "0.0.0.0"]))?;
    let o = address.octets();
    Some(Network { address, gateway, cidr: format!("{}.{}.{}.0/24", o[0], o[1], o[2]) })
}

/// This computer's own addresses, from `route print -4`: the host routes (mask 255.255.255.255) whose destination is
/// their own interface. Numbers only, so it reads the same in every Windows language.
pub fn parse_local_addresses(text: &str) -> Vec<Ipv4Addr> {
    let mut out = Vec::new();
    for line in text.lines() {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() >= 4 && p[1] == "255.255.255.255" && p[0] == p[3] {
            if let Ok(ip) = p[0].parse::<Ipv4Addr>() {
                if !ip.is_loopback() && !out.contains(&ip) {
                    out.push(ip);
                }
            }
        }
    }
    out
}

pub fn local_addresses() -> Vec<Ipv4Addr> {
    parse_local_addresses(&run("route", &["print", "-4"]))
}

pub fn hosts(net: &Network) -> Vec<Ipv4Addr> {
    let o = net.address.octets();
    (1..=254u8).map(|i| Ipv4Addr::new(o[0], o[1], o[2], i)).filter(|ip| *ip != net.address).collect()
}

#[link(name = "iphlpapi")]
extern "system" {
    fn SendARP(dest_ip: u32, src_ip: u32, mac: *mut u8, mac_len: *mut u32) -> u32;
}

/// Asks "who has this address?" and returns the answering device's hardware address. Windows retries a few times,
/// so phones in power-save mode still answer.
pub fn arp(ip: Ipv4Addr) -> Option<[u8; 6]> {
    let mut buf = [0u8; 8];
    let mut len: u32 = buf.len() as u32;
    let dest = u32::from_ne_bytes(ip.octets());
    // SAFETY: `buf` and `len` live for the whole call and `len` holds the buffer's size, as SendARP requires.
    let rc = unsafe { SendARP(dest, 0, buf.as_mut_ptr(), &mut len) };
    if rc != 0 || len < 6 {
        return None;
    }
    let mut mac = [0u8; 6];
    mac.copy_from_slice(&buf[..6]);
    (mac != [0; 6]).then_some(mac)
}

/// Finds every device that answers on the network, a few dozen addresses at a time.
pub fn sweep(hosts: &[Ipv4Addr]) -> Vec<(Ipv4Addr, [u8; 6])> {
    let queue = Arc::new(Mutex::new(hosts.to_vec()));
    let found = Arc::new(Mutex::new(Vec::new()));
    let workers: Vec<_> = (0..48)
        .map(|_| {
            let queue = Arc::clone(&queue);
            let found = Arc::clone(&found);
            std::thread::spawn(move || loop {
                let next = queue.lock().ok().and_then(|mut q| q.pop());
                let Some(ip) = next else { break };
                if let Some(mac) = arp(ip) {
                    if let Ok(mut f) = found.lock() {
                        f.push((ip, mac));
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
    let mut out = found.lock().map(|f| f.clone()).unwrap_or_default();
    out.sort_by_key(|(ip, _)| u32::from(*ip));
    out
}

pub fn mac_str(mac: &[u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":")
}

pub fn check_port(ip: Ipv4Addr, port: u16, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from((ip, port)), timeout).is_ok()
}

/// Opens a connection, sends one message, reads the reply (up to `max` bytes), hangs up.
pub fn exchange(ip: Ipv4Addr, port: u16, payload: &[u8], max: usize, timeout: Duration) -> Option<Vec<u8>> {
    let mut s = TcpStream::connect_timeout(&SocketAddr::from((ip, port)), timeout).ok()?;
    s.set_read_timeout(Some(timeout)).ok()?;
    s.set_write_timeout(Some(timeout)).ok()?;
    if !payload.is_empty() {
        s.write_all(payload).ok()?;
    }
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    while out.len() < max {
        match s.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => out.extend_from_slice(&buf[..n]),
        }
    }
    (!out.is_empty()).then_some(out)
}

/// A plain HTTP/1.0 GET (no chunking), returning (status, headers, body).
pub fn http_get(ip: Ipv4Addr, port: u16, path: &str) -> Option<(u16, String, String)> {
    http_request(ip, port, "GET", path, &[], "")
}

pub fn http_request(ip: Ipv4Addr, port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Option<(u16, String, String)> {
    let host = if port == 80 { ip.to_string() } else { format!("{ip}:{port}") };
    let mut req = format!("{method} {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: Porchlight\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if !body.is_empty() {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    req.push_str("\r\n");
    req.push_str(body);
    let raw = exchange(ip, port, req.as_bytes(), 128 * 1024, Duration::from_millis(2500))?;
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head.split_whitespace().nth(1)?.parse().ok()?;
    Some((status, head.to_string(), body.to_string()))
}

pub fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_route_lowest_metric_wins() {
        let text = "  0.0.0.0  0.0.0.0  10.0.0.1  10.0.0.23  50\n  0.0.0.0  0.0.0.0  192.168.50.1  192.168.50.7  25\n";
        assert_eq!(parse_default_route(text), Some(("192.168.50.1".parse().unwrap(), "192.168.50.7".parse().unwrap())));
    }

    #[test]
    fn this_computers_addresses_are_read_from_host_routes() {
        let text = "  10.9.8.20  255.255.255.255  On-link  10.9.8.20  281\n  127.0.0.1  255.255.255.255  On-link  127.0.0.1  331\n  10.9.8.0  255.255.255.0  On-link  10.9.8.20  281\n  192.168.56.1  255.255.255.255  Sur le lien  192.168.56.1  281\n";
        let got = parse_local_addresses(text);
        assert_eq!(got, vec!["10.9.8.20".parse::<Ipv4Addr>().unwrap()]);
    }

    #[test]
    fn mac_formatting() {
        assert_eq!(mac_str(&[0, 0xc0, 0xca, 0x0a, 0xbc, 0xff]), "00:c0:ca:0a:bc:ff");
    }
}
