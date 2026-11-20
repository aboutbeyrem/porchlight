//! Deeper checks of one device: which common "doors" (ports) answer, one at a time, and what a few of them say
//! when greeted. Only opening messages any client sends; never a user name or password.

use crate::net::{check_port, exchange};
use std::net::Ipv4Addr;
use std::time::Duration;

pub const HOME_PORTS: [u16; 18] = [21, 22, 23, 80, 443, 445, 554, 1883, 2323, 2375, 3389, 5555, 5900, 8000, 8080, 8554, 34567, 37777];

pub fn port_name(p: u16) -> &'static str {
    match p {
        21 => "old file transfer (FTP)",
        22 => "secure remote login (SSH)",
        23 | 2323 => "old remote login (Telnet)",
        80 | 8000 | 8080 => "web page",
        443 => "web page (encrypted)",
        445 => "Windows file sharing",
        554 | 8554 => "live video stream (RTSP)",
        1883 => "smart-home messages (MQTT)",
        2375 => "Docker remote control",
        3389 => "Windows Remote Desktop",
        5555 => "Android debugging (ADB)",
        5900 => "remote screen control (VNC)",
        34567 => "DVR remote viewing (XMEye)",
        37777 => "Dahua camera service",
        _ => "other service",
    }
}

/// One door at a time, so small devices (extenders, cameras) keep working.
pub fn scan_ports(ip: Ipv4Addr) -> Vec<u16> {
    HOME_PORTS.iter().copied().filter(|p| check_port(ip, *p, Duration::from_millis(1200))).collect()
}

const STREAM_PATHS: [&str; 7] = ["/", "/live", "/stream1", "/h264", "/Streaming/Channels/101", "/cam/realmonitor?channel=1&subtype=0", "/11"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Rtsp {
    Open,
    Protected,
    Unknown,
}

/// Asks the camera to describe its stream without a password. 200 = it shares video with anyone; 401 = it asks.
pub fn rtsp(ip: Ipv4Addr, port: u16) -> Rtsp {
    let mut saw_auth = false;
    for path in STREAM_PATHS {
        let req = format!("DESCRIBE rtsp://{ip}:{port}{path} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: Porchlight\r\n\r\n");
        let Some(reply) = exchange(ip, port, req.as_bytes(), 512, Duration::from_millis(2500)) else { break };
        let text = String::from_utf8_lossy(&reply);
        match text.split_whitespace().nth(1) {
            Some("200") => return Rtsp::Open,
            Some("401") => saw_auth = true,
            _ => {}
        }
    }
    if saw_auth { Rtsp::Protected } else { Rtsp::Unknown }
}

/// SMB1 NEGOTIATE offering only "NT LM 0.12". A server with SMBv1 turned off refuses it.
pub fn smb1(ip: Ipv4Addr) -> bool {
    let mut smb = vec![0xff, b'S', b'M', b'B', 0x72, 0, 0, 0, 0, 0x18, 0x01, 0xc8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xfe, 0, 0, 0, 0];
    smb.extend_from_slice(&[0x00, 0x0c, 0x00, 0x02]);
    smb.extend_from_slice(b"NT LM 0.12\0");
    let mut pkt = vec![0, 0, 0, smb.len() as u8];
    pkt.extend_from_slice(&smb);
    let Some(r) = exchange(ip, 445, &pkt, 256, Duration::from_millis(2500)) else { return false };
    r.len() >= 39 && r[4..8] == [0xff, b'S', b'M', b'B'] && r[8] == 0x72 && r[9..13] == [0, 0, 0, 0] && r[36] >= 1 && r[37] == 0 && r[38] == 0
}

/// Some(true) = Remote Desktop requires sign-in first (NLA); Some(false) = anyone reaches the sign-in screen.
pub fn rdp_nla(ip: Ipv4Addr) -> Option<bool> {
    let req = [0x03, 0x00, 0x00, 0x13, 0x0e, 0xe0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x08, 0x00, 0x01, 0, 0, 0];
    let r = exchange(ip, 3389, &req, 64, Duration::from_millis(2500))?;
    if r.len() < 11 || r[0] != 3 || r[5] & 0xf0 != 0xd0 {
        return None;
    }
    if r.len() < 19 {
        return Some(false);
    }
    let value = u32::from_le_bytes([r[15], r[16], r[17], r[18]]);
    match r[11] {
        2 => Some(false),
        3 => Some(value == 5 || value == 6),
        _ => None,
    }
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepResult {
    pub ports: Vec<u16>,
    pub rtsp_open: bool,
    pub rtsp_protected: bool,
    pub smb1: bool,
    pub rdp_no_nla: bool,
    pub checked_at: u64,
}

pub fn deep_check(ip: Ipv4Addr, now: u64) -> DeepResult {
    let ports = scan_ports(ip);
    let mut r = DeepResult { checked_at: now, ..Default::default() };
    if let Some(p) = [554u16, 8554].into_iter().find(|p| ports.contains(p)) {
        match rtsp(ip, p) {
            Rtsp::Open => r.rtsp_open = true,
            Rtsp::Protected => r.rtsp_protected = true,
            Rtsp::Unknown => {}
        }
    }
    if ports.contains(&445) {
        r.smb1 = smb1(ip);
    }
    if ports.contains(&3389) {
        r.rdp_no_nla = rdp_nla(ip) == Some(false);
    }
    r.ports = ports;
    r
}
