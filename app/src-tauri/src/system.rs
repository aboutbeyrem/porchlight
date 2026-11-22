//! This computer's own network settings: which DNS servers it asks, whether they answer honestly, and IPv6.
//! The one thing here that leaves your network is a single DNS lookup for a made-up name under example.com (a name
//! reserved for testing), which says nothing about you.

use crate::guard::{Device, Finding};
use crate::i18n::Lang;
use crate::tx;
use crate::net::{self, Network};
use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::time::Duration;

#[repr(C)]
struct IpAddrString {
    next: *const IpAddrString,
    ip: [u8; 16],
    mask: [u8; 16],
    context: u32,
}

/// FIXED_INFO from iphlpapi.h.
#[repr(C)]
struct FixedInfo {
    host: [u8; 132],
    domain: [u8; 132],
    current: *const IpAddrString,
    servers: IpAddrString,
    node_type: u32,
    scope: [u8; 260],
    routing: u32,
    proxy: u32,
    dns: u32,
}

#[link(name = "iphlpapi")]
extern "system" {
    fn GetNetworkParams(info: *mut FixedInfo, len: *mut u32) -> u32;
}

fn c_text(b: &[u8]) -> String {
    let end = b.iter().position(|c| *c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

/// The DNS servers Windows uses (IPv4).
pub fn dns_servers() -> Vec<Ipv4Addr> {
    let mut len = 0u32;
    // SAFETY: with a null buffer the call only reports the size it needs.
    unsafe { GetNetworkParams(std::ptr::null_mut(), &mut len) };
    let words = (len as usize).max(std::mem::size_of::<FixedInfo>()).div_ceil(8);
    let mut buf = vec![0u64; words];
    let info = buf.as_mut_ptr() as *mut FixedInfo;
    let mut size = (words * 8) as u32;
    // SAFETY: `buf` is 8-byte aligned and at least as large as Windows asked for.
    let rc = unsafe { GetNetworkParams(info, &mut size) };
    if rc != 0 {
        crate::log_warn!("GetNetworkParams returned {rc}");
        return Vec::new();
    }
    let mut out = Vec::new();
    // SAFETY: the list lives inside `buf`; Windows links its entries with `next`, ending with null.
    let mut node: *const IpAddrString = unsafe { &(*info).servers };
    for _ in 0..16 {
        let Some(n) = (unsafe { node.as_ref() }) else { break };
        if let Ok(ip) = c_text(&n.ip).trim().parse::<Ipv4Addr>() {
            if !ip.is_unspecified() && !out.contains(&ip) {
                out.push(ip);
            }
        }
        node = n.next;
    }
    out
}

/// A DNS question for the address (A record) of `name`.
pub fn dns_query(id: u16, name: &str) -> Vec<u8> {
    let mut q = id.to_be_bytes().to_vec();
    q.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
    for label in name.split('.').filter(|l| !l.is_empty()) {
        q.push(label.len().min(63) as u8);
        q.extend_from_slice(&label.as_bytes()[..label.len().min(63)]);
    }
    q.extend_from_slice(&[0, 0, 1, 0, 1]);
    q
}

/// Some(true) when a reply gives an address for a name that doesn't exist; Some(false) for an honest
/// "no such name"; None when the reply can't tell.
pub fn invents_answers(reply: &[u8], id: u16) -> Option<bool> {
    if reply.len() < 12 || reply[0..2] != id.to_be_bytes() || reply[2] & 0x80 == 0 {
        return None;
    }
    let answers = u16::from_be_bytes([reply[6], reply[7]]);
    match reply[3] & 0x0f {
        3 => Some(false),
        0 => Some(answers > 0),
        _ => None,
    }
}

/// Asks `server` for a random name under example.com, which has no such names.
pub fn probe_invented(server: Ipv4Addr) -> Option<bool> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(7);
    let id = (nanos & 0xffff) as u16;
    sock.send_to(&dns_query(id, &format!("porchlight-{nanos:x}.example.com")), (server, 53)).ok()?;
    let mut buf = [0u8; 512];
    for _ in 0..3 {
        let (n, from) = sock.recv_from(&mut buf).ok()?;
        if from.ip() == IpAddr::V4(server) {
            return invents_answers(&buf[..n], id);
        }
    }
    None
}

/// The address this computer would use to reach the IPv6 internet, if it has one. Nothing is sent: picking a
/// route for a UDP socket doesn't send a packet.
pub fn ipv6_address() -> Option<Ipv6Addr> {
    let s = UdpSocket::bind("[::]:0").ok()?;
    s.connect("[2001:4860:4860::8888]:53").ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V6(a) => Some(*a.ip()),
        SocketAddr::V4(_) => None,
    }
}

/// Global unicast (2000::/3), leaving out Teredo tunnels (2001:0::/32), which the router's firewall doesn't cover.
pub fn is_public_v6(ip: &Ipv6Addr) -> bool {
    let s = ip.segments();
    (s[0] & 0xe000) == 0x2000 && !(s[0] == 0x2001 && s[1] == 0)
}

/// IPv6 default routes from `route print -6`: (interface, router address). The numbers and addresses aren't
/// translated, so this works in every Windows language.
pub fn parse_v6_defaults(text: &str) -> Vec<(u32, String)> {
    let mut out: Vec<(u32, String)> = Vec::new();
    for line in text.lines() {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() >= 4 && p[2] == "::/0" && p[3].contains(':') {
            if let Ok(iface) = p[0].parse::<u32>() {
                let entry = (iface, p[3].to_lowercase());
                if iface != 0 && !out.contains(&entry) {
                    out.push(entry);
                }
            }
        }
    }
    out
}

/// Interfaces where more than one device announces itself as the IPv6 router.
pub fn competing_routers(defaults: &[(u32, String)]) -> Vec<Vec<String>> {
    let mut by_iface: HashMap<u32, Vec<String>> = HashMap::new();
    for (i, gw) in defaults {
        by_iface.entry(*i).or_default().push(gw.clone());
    }
    by_iface.into_values().filter(|g| g.len() > 1).collect()
}

/// What Porchlight learns about this computer's own settings in one look.
#[derive(Debug, Default, Clone)]
pub struct Look {
    pub dns: Vec<Ipv4Addr>,
    pub invents: Option<bool>,
    pub public_v6: bool,
    pub v6_routers: Vec<(u32, String)>,
}

/// `probe` also sends the DNS test lookup (full checkups only).
pub fn look(probe: bool) -> Look {
    let dns = dns_servers();
    let invents = if probe { dns.first().and_then(|s| probe_invented(*s)) } else { None };
    let public_v6 = ipv6_address().is_some_and(|a| is_public_v6(&a));
    let v6_routers = parse_v6_defaults(&net::run("route", &["print", "-6"]));
    crate::log_info!("system: {} DNS servers, invents={invents:?}, public IPv6={public_v6}, {} IPv6 routes", dns.len(), v6_routers.len());
    Look { dns, invents, public_v6, v6_routers }
}

fn finding(id: &str, level: &str, title: String, found: String, means: String, likely: String, fix: Vec<String>) -> Finding {
    Finding { id: id.into(), level: level.into(), title, found, means, likely, fix, device: None }
}

fn in_subnet(ip: Ipv4Addr, netw: &Network) -> bool {
    ip.octets()[..3] == netw.address.octets()[..3]
}

/// Findings about this computer's DNS and IPv6, in plain words.
pub fn findings(look: &Look, netw: &Network, devices: &BTreeMap<String, Device>, l: Lang) -> Vec<Finding> {
    let mut out = Vec::new();
    if look.invents == Some(true) {
        out.push(finding("PL-DNS-INVENTS", "good-to-know",
            tx!(l, "Your DNS makes up answers for websites that don't exist", "Votre DNS invente des réponses pour des sites qui n'existent pas", "خادم DNS لديك يختلق إجابات لمواقع غير موجودة"),
            tx!(l, "When this computer looks up a website name that doesn't exist, your DNS server answers with an address anyway, instead of \"no such name\".", "Quand cet ordinateur cherche un nom de site qui n'existe pas, votre serveur DNS répond quand même par une adresse, au lieu de « ce nom n'existe pas ».", "عندما يبحث هذا الحاسوب عن اسم موقع غير موجود، يردّ خادم DNS بعنوان رغم ذلك، بدلاً من \"لا يوجد هذا الاسم\"."),
            tx!(l, "Mistyped addresses then open a page chosen by whoever runs that DNS server (often an internet provider's search or ad page). It also shows the answers you get can be changed on the way.", "Les adresses mal tapées ouvrent alors une page choisie par celui qui gère ce serveur DNS (souvent une page de recherche ou de publicité du fournisseur d'accès). Cela montre aussi que les réponses peuvent être modifiées en chemin.", "العناوين المكتوبة خطأً تفتح عندها صفحة يختارها من يدير خادم DNS (غالباً صفحة بحث أو إعلانات لمزوّد الإنترنت). وهذا يبيّن أيضاً أن الإجابات يمكن تغييرها في الطريق."),
            tx!(l, "Low on its own; it's usually your internet provider, not an attacker.", "Faible en soi ; c'est généralement votre fournisseur d'accès, pas un attaquant.", "منخفض بحد ذاته؛ عادةً يكون مزوّد الإنترنت وليس مهاجماً."),
            vec![tx!(l, "Open your router's settings and look for DNS.", "Ouvrez les réglages de votre routeur et cherchez DNS.", "افتح إعدادات الراوتر وابحث عن DNS."),
                 tx!(l, "Turn off \"DNS assistance\", \"Search assist\" or similar if offered, or set the DNS servers to a provider you trust (for example 1.1.1.1 or 9.9.9.9).", "Désactivez « Assistance DNS », « Aide à la recherche » ou équivalent si proposé, ou réglez les serveurs DNS sur un fournisseur de confiance (par exemple 1.1.1.1 ou 9.9.9.9).", "أوقف \"DNS assistance\" أو \"Search assist\" أو ما يشبهها إن وُجدت، أو اضبط خوادم DNS على مزوّد تثق به (مثلاً 1.1.1.1 أو 9.9.9.9).")]));
    }
    for ip in look.dns.iter().filter(|ip| in_subnet(**ip, netw) && **ip != netw.gateway) {
        let who = devices.values().find(|d| d.ip == ip.to_string()).map(|d| d.name.clone()).unwrap_or_else(|| tx!(l, "a device Porchlight hasn't named", "un appareil que Porchlight n'a pas nommé", "جهاز لم يسمّه Porchlight"));
        out.push(finding("PL-DNS-LOCAL", "good-to-know",
            tx!(l, "Website lookups go through another device on your network", "La recherche des sites passe par un autre appareil de votre réseau", "البحث عن المواقع يمر عبر جهاز آخر على شبكتك"),
            tx!(l, format!("This computer's DNS server is {ip} ({who}), not your router."), format!("Le serveur DNS de cet ordinateur est {ip} ({who}), pas votre routeur."), format!("خادم DNS لهذا الحاسوب هو {ip} ({who})، وليس الراوتر.")),
            tx!(l, "Every website name this computer looks up goes through that device first. That's normal for an ad blocker like Pi-hole; if you didn't set one up, a device may have taken over this job to send you to fake websites.", "Chaque nom de site que cet ordinateur cherche passe d'abord par cet appareil. C'est normal pour un bloqueur de publicités comme Pi-hole ; si vous n'en avez pas installé, un appareil a peut-être pris ce rôle pour vous envoyer vers de faux sites.", "كل اسم موقع يبحث عنه هذا الحاسوب يمر عبر ذلك الجهاز أولاً. هذا طبيعي لمانع إعلانات مثل Pi-hole؛ وإن لم تُعدّ واحداً، فربما استولى جهاز على هذه المهمة ليوجهك إلى مواقع مزيفة."),
            tx!(l, "Low if you set it up; high if you didn't.", "Faible si c'est vous qui l'avez installé ; élevé sinon.", "منخفض إن كنت أعددته بنفسك؛ مرتفع إن لم تفعل."),
            vec![tx!(l, "If you run an ad blocker or Pi-hole, all good.", "Si vous utilisez un bloqueur de publicités ou Pi-hole, tout va bien.", "إن كنت تستخدم مانع إعلانات أو Pi-hole، فلا مشكلة."),
                 tx!(l, "If not: restart your router, then check again. If it stays, unplug the device at that address.", "Sinon : redémarrez votre routeur, puis vérifiez de nouveau. Si cela reste, débranchez l'appareil à cette adresse.", "وإلا: أعد تشغيل الراوتر ثم افحص مجدداً. إن بقي الأمر، افصل الجهاز ذا ذلك العنوان.")]));
    }
    if look.public_v6 {
        out.push(finding("PL-IPV6-PUBLIC", "good-to-know",
            tx!(l, "Your network uses IPv6, so devices have their own internet addresses", "Votre réseau utilise l'IPv6 : les appareils ont leur propre adresse Internet", "شبكتك تستخدم IPv6، لذا لكل جهاز عنوانه الخاص على الإنترنت"),
            tx!(l, "This computer has a public IPv6 address. With IPv6, each device can have an address the internet can reach directly, unlike IPv4 where the router hides them.", "Cet ordinateur a une adresse IPv6 publique. Avec l'IPv6, chaque appareil peut avoir une adresse joignable directement depuis Internet, contrairement à l'IPv4 où le routeur les cache.", "لهذا الحاسوب عنوان IPv6 عام. مع IPv6 يمكن لكل جهاز أن يحصل على عنوان يصل إليه الإنترنت مباشرة، بخلاف IPv4 حيث يخفيها الراوتر."),
            tx!(l, "Your router's IPv6 firewall is what stops strangers from connecting to your devices. Most routers turn it on by default, but some internet-provider boxes ship with it off.", "C'est le pare-feu IPv6 du routeur qui empêche des inconnus de se connecter à vos appareils. La plupart des routeurs l'activent par défaut, mais certaines box de fournisseurs sont livrées sans.", "جدار حماية IPv6 في الراوتر هو ما يمنع الغرباء من الاتصال بأجهزتك. معظم الراوترات تفعّله افتراضياً، لكن بعض أجهزة مزوّدي الإنترنت تأتي وهو متوقف."),
            tx!(l, "Low if the router's IPv6 firewall is on.", "Faible si le pare-feu IPv6 du routeur est actif.", "منخفض إن كان جدار حماية IPv6 في الراوتر مفعّلاً."),
            vec![tx!(l, "Open your router's settings → Firewall or IPv6.", "Ouvrez les réglages du routeur → Pare-feu ou IPv6.", "افتح إعدادات الراوتر ← جدار الحماية أو IPv6."),
                 tx!(l, "Make sure incoming IPv6 connections are blocked (\"IPv6 firewall: on\" or \"Block inbound\").", "Vérifiez que les connexions IPv6 entrantes sont bloquées (« Pare-feu IPv6 : activé » ou « Bloquer les entrées »).", "تأكد أن اتصالات IPv6 الواردة محظورة (\"IPv6 firewall: on\" أو \"Block inbound\").")]));
    }
    for routers in competing_routers(&look.v6_routers) {
        let n = routers.len();
        out.push(finding("PL-IPV6-ROUTERS", "worth-fixing",
            tx!(l, "More than one device is acting as your network's IPv6 router", "Plusieurs appareils jouent le rôle de routeur IPv6 de votre réseau", "أكثر من جهاز يتصرف كراوتر IPv6 لشبكتك"),
            tx!(l, format!("{n} devices are announcing themselves as the way to the IPv6 internet."), format!("{n} appareils s'annoncent comme le chemin vers l'Internet IPv6."), format!("{n} أجهزة تعلن أنها الطريق إلى إنترنت IPv6.")),
            tx!(l, "Normally only your router does this. A second one can be a mesh unit or a second router; it's also how some attacks (\"rogue router advertisements\") put a device in the middle of your traffic.", "Normalement, seul votre routeur fait cela. Un second peut être un module mesh ou un second routeur ; c'est aussi ainsi que certaines attaques (« fausses annonces de routeur ») placent un appareil au milieu de votre trafic.", "عادةً لا يفعل هذا سوى الراوتر. قد يكون الثاني وحدة mesh أو راوتر ثانياً؛ وهكذا أيضاً تضع بعض الهجمات (\"إعلانات راوتر مزيفة\") جهازاً في منتصف بياناتك."),
            tx!(l, "Low to moderate: usually a second router, sometimes an attack.", "Faible à modéré : généralement un second routeur, parfois une attaque.", "منخفض إلى متوسط: عادةً راوتر ثانٍ، وأحياناً هجوم."),
            vec![tx!(l, "If you have two routers or a mesh system, turn off IPv6 router announcements (RA) on all but the main one.", "Si vous avez deux routeurs ou un système mesh, désactivez les annonces de routeur IPv6 (RA) sur tous sauf le principal.", "إن كان لديك راوتران أو نظام mesh، أوقف إعلانات راوتر IPv6 (RA) على الجميع ما عدا الرئيسي."),
                 tx!(l, "If you don't, restart your router and check again; if it stays, look for a device you don't recognise.", "Sinon, redémarrez votre routeur et vérifiez de nouveau ; si cela reste, cherchez un appareil que vous ne reconnaissez pas.", "وإلا، أعد تشغيل الراوتر وافحص مجدداً؛ إن بقي الأمر، ابحث عن جهاز لا تعرفه.")]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(id: u16, rcode: u8, answers: u16) -> Vec<u8> {
        let mut r = id.to_be_bytes().to_vec();
        r.extend_from_slice(&[0x81, 0x80 | rcode, 0, 1]);
        r.extend_from_slice(&answers.to_be_bytes());
        r.extend_from_slice(&[0, 0, 0, 0]);
        r
    }

    #[test]
    fn dns_questions_are_well_formed() {
        let q = dns_query(0x1234, "a.example.com");
        assert_eq!(&q[..4], &[0x12, 0x34, 0x01, 0x00]);
        assert_eq!(&q[12..], &[1, b'a', 7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0, 1, 0, 1]);
    }

    #[test]
    fn an_address_for_a_missing_name_is_an_invented_answer() {
        assert_eq!(invents_answers(&reply(7, 0, 1), 7), Some(true));
    }

    #[test]
    fn no_such_name_is_an_honest_answer() {
        assert_eq!(invents_answers(&reply(7, 3, 0), 7), Some(false));
    }

    #[test]
    fn a_reply_to_another_question_is_ignored() {
        assert_eq!(invents_answers(&reply(8, 0, 1), 7), None);
    }

    #[test]
    fn only_global_ipv6_addresses_count_as_public() {
        assert!(is_public_v6(&"2a01:e0a:1:2::5".parse().unwrap()));
        assert!(!is_public_v6(&"fe80::1".parse().unwrap()));
        assert!(!is_public_v6(&"fd00::5".parse().unwrap()));
        assert!(!is_public_v6(&"2001:0:4136:e378::1".parse().unwrap()));
    }

    #[test]
    fn ipv6_default_routes_are_read_in_any_language() {
        let text = "IPv6-Routentabelle\n Schnittstelle Metrik Netzwerkziel Gateway\n 12    281 ::/0                     fe80::1\n 12    281 ::/0                     FE80::2\n  1    331 ::1/128                  Auf Verbindung\n";
        assert_eq!(parse_v6_defaults(text), vec![(12, "fe80::1".into()), (12, "fe80::2".into())]);
    }

    #[test]
    fn two_ipv6_routers_on_one_interface_compete() {
        assert_eq!(competing_routers(&[(12, "fe80::1".into()), (12, "fe80::2".into())]).len(), 1);
        assert!(competing_routers(&[(12, "fe80::1".into()), (14, "fe80::9".into())]).is_empty());
    }

    /// Run on a real network: cargo test live_look -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_look() {
        let l = look(true);
        println!("dns servers: {}, invents: {:?}, public v6: {}, v6 default routes: {}", l.dns.len(), l.invents, l.public_v6, l.v6_routers.len());
        assert!(!l.dns.is_empty());
    }

    #[test]
    fn a_dns_server_on_another_local_device_is_mentioned() {
        let netw = Network { address: "10.9.8.20".parse().unwrap(), gateway: "10.9.8.1".parse().unwrap(), cidr: "10.9.8.0/24".into() };
        let look = Look { dns: vec!["10.9.8.53".parse().unwrap(), "10.9.8.1".parse().unwrap()], ..Default::default() };
        let out = findings(&look, &netw, &BTreeMap::new(), Lang::En);
        assert_eq!(out.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), vec!["PL-DNS-LOCAL"]);
    }
}
