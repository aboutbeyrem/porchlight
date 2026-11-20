// Turns raw scan results into findings a non-technical person can act on.
// Every finding: what we found, what it means, how likely it matters, and how to fix it. No fear, no exaggeration:
// risk is described as "who would need to do what", never as a worst-case story.
import { COMMON_PORTS } from "./ports.js";
import { protectionLevel, sameHardware, sameRouter, beaconProtection, isAlfa } from "./wifi.js";
import { isPrivateMac } from "./mdns.js";

export const LEVELS = ["fix-soon", "worth-fixing", "good-to-know", "all-good"];
export const LEVEL_LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know", "all-good": "All good" };

const CAMERA_PORTS = [554, 8554, 34567, 37777];

export const EXTENDER = "Wi-Fi extender or access point";
export const CAMERA = "camera or recorder";
export const PRIVATE = "phone, tablet or laptop";
export const BEHIND = "device on your Wi-Fi extender";

// Makers whose name alone says what the device is.
function kindFromVendor(v = "") {
  if (/hikvision|dahua|reolink|ezviz|uniview|hanwha|axis comm|imou|wyze/i.test(v)) return CAMERA;
  if (/espressif|tuya|shelly|sonoff|itead|lifx|signify|philips lighting/i.test(v)) return "smart-home device";
  if (/raspberry/i.test(v)) return "computer";
  if (/^apple/i.test(v)) return "Apple device";
  return null;
}

export function deviceKind(d) {
  const text = `${d.friendlyName || ""} ${d.manufacturer || ""} ${d.modelName || ""} ${d.hostname || ""} ${d.web?.title || ""} ${d.mdns?.name || ""} ${d.mdns?.model || ""} ${d.mdns?.host || ""} ${d.netbios?.name || ""}`.toLowerCase();
  if (d.isRouter) return "router";
  if (d.self) return "this computer";
  const vendorKind = kindFromVendor(d.vendor);
  if (/camera|ipc|nvr|dvr|hikvision|dahua|reolink|ezviz|imou|tapo c|xiongmai|netcam/.test(text) || vendorKind === CAMERA || d.ports?.some((p) => CAMERA_PORTS.includes(p))) return CAMERA;
  if (d.broadcasts?.length || /pix-?link|repeater|extender|range ?ext|mesh wi-?fi|access point/.test(text)) return EXTENDER;
  if (d.mdns?.kind && d.mdns.kind !== "Apple device") return d.mdns.kind;
  if (d.behind) return BEHIND;
  if (/\btv\b|bravia|roku|chromecast|fire ?tv|android ?tv|webos|tizen/.test(text)) return "TV or streaming device";
  if (/printer|epson|canon|brother|hp ?(deskjet|laserjet|officejet)/.test(text)) return "printer";
  if (/iphone|ipad|android|galaxy|redmi|oppo|pixel|phone/.test(text)) return "phone or tablet";
  if (vendorKind && vendorKind !== "Apple device") return vendorKind;
  if (d.mdns?.kind === "Apple device" || vendorKind === "Apple device") return "Apple phone, tablet or computer";
  if (d.netbios || d.ports?.includes(3389) || d.ports?.includes(445)) return "computer";
  if (isPrivateMac(d.mac)) return PRIVATE;
  return "device";
}

export function deviceName(d) {
  if (d.self) return "This computer";
  if (d.isRouter) return d.friendlyName ? `Your router (${d.friendlyName})` : "Your router";
  const clean = (s) => s?.replace(/\.(lan|home|local|localdomain)$/i, "");
  const label = d.friendlyName || d.mdns?.name || d.web?.label || d.netbios?.name || clean(d.hostname) || clean(d.mdns?.host);
  if (label) return `${label} (${d.ip})`;
  const kind = deviceKind(d);
  if (d.vendor) return kind === "device" ? `${d.vendor} device at ${d.ip}` : `${capitalize(kind)} (${d.vendor}) at ${d.ip}`;
  return `${capitalize(kind)} at ${d.ip}`;
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function finding(level, device, title, found, means, likely, fix, minutes) {
  return { level, device: device?.ip || null, deviceName: device ? deviceName(device) : null, title, found, means, likely, fix, minutes };
}

const withSsid = (ssid, ...args) => ({ ...finding(...args), ssid });

function forwardedTo(mappings, ip, port) {
  return mappings.find((m) => m.enabled && m.internalClient === ip && (port === undefined || m.internalPort === port));
}

// Which of the Wi-Fi networks this computer can hear are yours: the one you named (or are connected to), a second
// name from the same router (guest, 5 GHz), one whose name extends yours ("HomeNet-EXT"), or one broadcast
// by a device we found on your network (an extender). Neighbours' networks are never reported on.
// Several access points can use your Wi-Fi's name: your router's radios, a mesh or extender, or a copy run by
// someone else. Group them by hardware and decide which group is really yours: the one this computer is connected
// to, or one that belongs to a device on your network, or else the best-protected one. A copy never gets to decide.
const normSsid = (s = "") => s.normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]/g, "").toLowerCase();
const STRENGTH = { open: 0, wep: 1, wpa: 2, "wpa2-tkip": 3, wpa2: 4, "wpa2-wpa3": 5, wpa3: 5, unknown: -1 };
const apLevel = (a) => { const p = beaconProtection(a.security); return protectionLevel(p?.auth, p?.cipher); };

export function homeAccessPoints({ wifi, home, devices = [] }) {
  const connected = wifi?.adapters?.find((a) => a.connected);
  const same = (wifi?.aps || []).filter((a) => a.ssid && normSsid(a.ssid) === normSsid(home || ""));
  const clusters = [];
  for (const ap of same) {
    const c = clusters.find((cl) => cl.some((x) => x.bssid === ap.bssid || sameRouter(x.bssid, ap.bssid)));
    c ? c.push(ap) : clusters.push([ap]);
  }
  const isConnected = (cl) => cl.some((a) => a.bssid === connected?.bssid);
  const tied = (cl) => isConnected(cl) || cl.some((a) => devices.some((d) => d.mac && !d.self && !d.behind && sameHardware(d.mac, a.bssid)));
  const real = clusters.filter(tied);
  // When this computer isn't connected over Wi-Fi, your router's own radios usually can't be tied to anything we
  // see, so the best-protected group with your exact name is taken as your router. A copy only wins that if it's
  // at least as well protected, and then it's reported as "another access point", never as a problem with yours.
  if (!clusters.some(isConnected)) {
    const strength = (cl) => Math.max(...cl.map((a) => STRENGTH[apLevel(a)] ?? -1));
    const best = clusters.filter((cl) => !real.includes(cl) && cl.some((a) => a.ssid === home)).sort((a, b) => strength(b) - strength(a) || b.length - a.length)[0];
    if (best) real.push(best);
  }
  return { clusters, real };
}

export function ownNetworks({ wifi, homeSsid, devices = [] }) {
  const connected = wifi?.adapters?.find((a) => a.connected);
  const home = connected?.ssid || homeSsid || null;
  const aps = wifi?.aps || [];
  const nets = wifi?.networks || [];
  const names = new Set([...nets.map((n) => n.ssid), ...aps.map((a) => a.ssid), connected?.ssid].filter(Boolean));
  const realHome = homeAccessPoints({ wifi, home, devices }).real.flat();
  const homeBssids = realHome.map((a) => a.bssid);
  const out = [];
  for (const ssid of names) {
    const its = ssid === home ? realHome.filter((a) => a.ssid === home) : aps.filter((a) => a.ssid === ssid);
    const device = devices.find((d) => !d.self && !d.isRouter && !d.behind && d.mac && its.some((a) => sameHardware(d.mac, a.bssid)));
    let reason = null;
    if (ssid === home) reason = "home";
    else if (device) reason = "device";
    else if (its.some((a) => homeBssids.some((b) => sameRouter(a.bssid, b)))) reason = "same-router";
    else if (home && ssid.startsWith(home) && /^[-_ .]/.test(ssid.slice(home.length))) reason = "name";
    if (!reason) continue;
    // Protection: the connected network's own report first, then what the access point announces, then the OS list.
    const n = nets.find((x) => x.ssid === ssid) || {};
    const isConn = ssid === connected?.ssid;
    const fromBeacon = its.map((x) => beaconProtection(x.security)).find(Boolean);
    const p = isConn ? { auth: connected.auth, cipher: connected.cipher } : fromBeacon || { auth: n.auth, cipher: n.cipher };
    out.push({ ssid, reason, device: device || null, auth: p.auth, cipher: p.cipher, aps: its });
  }
  return out.sort((a, b) => (a.reason === "home" ? -1 : b.reason === "home" ? 1 : 0));
}

const apLabel = (d) => {
  const brand = d.friendlyName || d.web?.label;
  const kind = deviceKind(d) === CAMERA ? "camera" : "extender";
  return brand ? `${brand} ${kind}` : `Wi-Fi ${kind}`;
};

function where(net) {
  if (net.reason === "device") return ` (broadcast by your ${apLabel(net.device)} at ${net.device.ip})`;
  if (net.reason === "same-router") return " (a second network from your router)";
  if (net.reason === "name") return " (its name extends yours, so it's likely your extender or second band)";
  return "";
}

export function wifiFindings({ wifi, homeSsid, devices = [] }) {
  const out = [];
  const mine = ownNetworks({ wifi, homeSsid, devices });
  const router = devices.find((d) => d.isRouter);
  const settingsOf = (net) => (net.device ? `Open your ${apLabel(net.device)}'s settings page (${net.device.web?.url || `http://${net.device.ip}/`}) and log in.` : `Open your router's settings page${router ? ` (http://${router.ip})` : ""} and log in.`);

  // Protection. Problems get one finding each; networks that are fine share one.
  const fine = [];
  for (const net of mine) {
    const level = protectionLevel(net.auth, net.cipher);
    const ssid = `"${net.ssid}"`;
    const fix = {
      open: ["fix-soon", `Your Wi-Fi ${ssid} has no password`, "Anyone nearby can join it and see what's on your network.", "High: anyone within range can join.", [settingsOf(net), "Wi-Fi → Security: choose WPA2-Personal (AES) or WPA3, and set a password of 12+ characters.", "Reconnect your devices with the new password."]],
      wep: ["fix-soon", `Your Wi-Fi ${ssid} uses WEP, which is broken`, "WEP can be cracked in minutes with free tools, so the password doesn't really protect it.", "High: anyone within range with a laptop can get in.", [settingsOf(net), "Wi-Fi → Security: choose WPA2-Personal (AES) or WPA3.", "Reconnect your devices."]],
      wpa: ["worth-fixing", `Your Wi-Fi ${ssid} uses old WPA protection`, "The original WPA has known weaknesses and is no longer considered safe.", "Moderate: it needs someone within Wi-Fi range.", [settingsOf(net), "Wi-Fi → Security: choose WPA2-Personal (AES) or WPA3.", "Reconnect your devices."]],
      "wpa2-tkip": ["worth-fixing", `Your Wi-Fi ${ssid} uses WPA2 with the old TKIP cipher`, "TKIP is outdated and slower; AES is the safe choice.", "Low to moderate.", [settingsOf(net), "Wi-Fi → Security: set encryption to AES (CCMP) only."]],
    }[level];
    if (fix) out.push({ ...finding(fix[0], net.device, fix[1], `${fix[1]}${where(net)}.`, fix[2], fix[3], fix[4], 10), ssid: net.ssid });
    else if (["wpa2", "wpa2-wpa3", "wpa3"].includes(level)) fine.push({ net, level });
  }
  if (fine.length) {
    const label = (l) => (l === "wpa2" ? "WPA2" : l === "wpa3" ? "WPA3" : "WPA2/WPA3");
    out.push(finding("all-good", null,
      fine.length === 1 ? `Your Wi-Fi "${fine[0].net.ssid}" is well protected` : `Your ${fine.length} Wi-Fi networks are well protected`,
      fine.map(({ net, level }) => `"${net.ssid}"${where(net)} uses ${label(level)}.`).join(" "),
      "That's the current standard. Its real strength is the password: 12+ characters that aren't a name or a date is what keeps it safe.",
      "Nothing to do." + (fine.some((f) => f.level === "wpa2") ? " If your router offers WPA3, you can switch later." : ""), [], 0));
  }

  // WPS, read from what each access point announces.
  if (wifi?.wpsCheckable) {
    const checked = mine.filter((n) => n.aps.length);
    const withWps = checked.filter((n) => n.aps.some((a) => a.wps));
    const without = checked.filter((n) => !withWps.includes(n));
    for (const net of withWps) {
      const w = net.aps.find((a) => a.wps).wps;
      out.push(withSsid(net.ssid, "worth-fixing", net.device, `WPS is on for "${net.ssid}"`,
        `"${net.ssid}"${where(net)} announces WPS, the "press a button or type an 8-digit PIN to connect" feature${w.locked ? ". Its PIN is locked right now, which slows attacks down" : ""}.` +
          (without.length ? ` WPS is already off on ${without.map((n) => `"${n.ssid}"`).join(" and ")}.` : ""),
        "The PIN part of WPS has a known design weakness: on some devices, someone within Wi-Fi range can work out the PIN with free tools and get the Wi-Fi password, however long it is. The push-button part is fine.",
        "Low to moderate: it needs someone within range of your Wi-Fi, and it only works on some models. Turning WPS off costs nothing unless you connect devices with the WPS button.",
        [settingsOf(net), "Find WPS (usually under Wireless, Wi-Fi or WLAN) and turn it off, then save.", "Run Porchlight again to confirm it's off."], 5));
    }
    if (checked.length && !withWps.length) {
      const list = checked.map((n) => `"${n.ssid}"`).join(" and ");
      out.push(finding("all-good", null, `WPS is off on ${list}`,
        `${list} ${checked.length === 1 ? "doesn't" : "don't"} announce WPS, the PIN-based way to join a network. (We can only check networks this computer can hear; an extender in another room may need its own check.)`,
        "WPS's PIN mode has a known weakness, so having it off is the safer setting.", "Nothing to do.", [], 0));
    }
  }

  if (!mine.length && homeSsid) {
    out.push(finding("good-to-know", null, `We couldn't see "${homeSsid}" from this computer`,
      `Your Wi-Fi "${homeSsid}" didn't show up in this computer's list of nearby networks.`,
      "It may be hidden, out of range, or on a band this adapter can't hear. Hiding a network doesn't protect it, so its password and protection type still matter.",
      "Nothing to worry about.", ["Run Porchlight on a computer connected to that Wi-Fi to check its protection."], 0));
  }
  return out;
}

const adapterLabel = (a) => (a.chipset?.alfa || isAlfa(a.mac) ? "Your ALFA Wi-Fi adapter" : `Your Wi-Fi adapter "${a.name}"`);

// ---------- Copies of your Wi-Fi's name ----------
// A network with your Wi-Fi's exact name (or the same name with different capitals or spaces) broadcast by an access
// point that isn't one of yours. Spotted from the normal list of nearby networks: no monitor mode needed.
export function lookalikes({ wifi, homeSsid, devices = [] }) {
  const connected = wifi?.adapters?.find((a) => a.connected);
  const home = connected?.ssid || homeSsid;
  if (!home || !(wifi?.aps || []).length) return { checked: false, copies: [] };
  const { clusters, real } = homeAccessPoints({ wifi, home, devices });
  const realLevel = Math.max(-1, ...real.flat().map((a) => STRENGTH[apLevel(a)] ?? -1));
  const copies = clusters.filter((cl) => !real.includes(cl)).map((cl) => {
    const level = apLevel(cl[0]);
    const weaker = realLevel >= 0 && (STRENGTH[level] ?? -1) >= 0 && STRENGTH[level] < realLevel;
    return { ssid: cl[0].ssid, bssids: cl.map((a) => a.bssid), level, weaker, exactName: cl[0].ssid === home };
  });
  return { checked: true, home, copies };
}

export function lookalikeFindings(args) {
  const { checked, home, copies } = lookalikes(args);
  if (!checked) return [];
  if (!copies.length) {
    return [finding("all-good", null, "No copies of your Wi-Fi nearby",
      `None of the networks this computer can hear pretends to be "${home}".`,
      "A fake copy of your network is a trick to get your devices to connect to someone else's access point. There's none in range right now.",
      "Nothing to do.", [], 0)];
  }
  return copies.map((c) => {
    const name = c.exactName ? `"${c.ssid}"` : `"${c.ssid}" (almost the same as "${home}")`;
    const plain = { open: "no password", wep: "old WEP protection", wpa: "old WPA protection", "wpa2-tkip": "WPA2 with an old cipher" }[c.level];
    if (c.weaker) {
      return withSsid(c.ssid, "worth-fixing", null, `A network with ${plain || "weaker protection"} is using your Wi-Fi's name`,
        `Another access point nearby broadcasts ${name} with ${plain || "weaker protection than yours"}. It doesn't belong to your router or extender.`,
        "Phones and laptops join networks by name. A copy with weaker protection can trick a device into joining it, and whoever runs it could then see that device's unencrypted traffic.",
        "Low to moderate: it could also be a neighbour whose router happens to use the same name. It matters more if your Wi-Fi name is unusual.",
        ["Don't connect to it. On your phone, a copy usually shows without a lock icon.", "If any of your devices saved that open network, tell them to forget it.", "Give your Wi-Fi a name that's unique (not your family name or address), so copies stand out.", "Run Porchlight again later to see if it's still there."], 10);
    }
    return finding("good-to-know", null, `Another access point uses your Wi-Fi's name`,
      `An access point that doesn't seem to belong to your router broadcasts ${name}, with the same kind of protection.`,
      "That's normal if you have a mesh system or an extender set to the same name. Otherwise it may be a neighbour with the same default name, or a copy.",
      "Low: devices can only join it if it also knows your password, or if you join it by mistake.",
      ["If you have a mesh system or a second access point, this is probably it.", "If you don't, give your Wi-Fi a unique name so you can tell yours apart."], 5);
  });
}

// ---------- Since the last checkup ----------
export function changeFindings(changes) {
  const out = [];
  if (!changes || changes.firstRun) return out;
  const when = changes.since ? new Date(changes.since).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "last time";
  if (changes.newDevices.length) {
    const names = changes.newDevices.map((d) => deviceName(d));
    out.push({
      ...finding("good-to-know", changes.newDevices.length === 1 ? changes.newDevices[0] : null,
        changes.newDevices.length === 1 ? "A new device joined your network" : `${changes.newDevices.length} new devices joined your network`,
        `New since your last checkup (${when}): ${names.join(", ")}.`,
        "Usually that's a new phone, a guest, or something that was switched off last time. If you don't recognise it, someone else may know your Wi-Fi password.",
        "Low, if you recognise it.",
        ["Check the device list below: its type and address can help you recognise it.", "If you don't recognise it, change your Wi-Fi password in your router's settings, then reconnect your own devices."], 5),
      isNew: true,
    });
  }
  if (changes.fixed.length) {
    out.push(finding("all-good", null, changes.fixed.length === 1 ? "Fixed since your last checkup" : `${changes.fixed.length} things fixed since your last checkup`,
      changes.fixed.map((p) => `${p.title}${p.deviceName ? ` (${p.deviceName})` : ""}`).join(". ") + ".",
      "Porchlight checked again and these are gone. Nice work.", "Nothing to do.", [], 0));
  }
  return out;
}

// ---------- A score out of 100, from the problems only (notes and good news don't cost points) ----------
export function scoreOf(findings) {
  const cost = { "fix-soon": 25, "worth-fixing": 10 };
  const value = Math.max(0, 100 - findings.reduce((s, f) => s + (cost[f.level] || 0), 0));
  const label = value >= 90 ? "Well protected" : value >= 70 ? "A few things to tidy up" : value >= 45 ? "Needs some attention" : "Start with the top items";
  return { value, label };
}

export function buildFindings({ devices, upnp, routerAdmin, wifi, homeSsid, firewall = null }) {
  const out = [];
  const mappings = upnp?.router?.mappings || [];

  for (const d of devices) {
    const name = deviceName(d);
    const ports = d.ports || [];

    const telnet = [23, 2323].find((p) => ports.includes(p));
    if (telnet) {
      const fwd = forwardedTo(mappings, d.ip, telnet);
      out.push(finding("fix-soon", d, "Old remote-login service (Telnet) is on",
        `${name} accepts Telnet${telnet === 2323 ? " (on port 2323)" : ""}, an old way to log into a device remotely.`,
        "Telnet sends passwords as readable text, and it is the main door automated attacks use to take over cameras and routers." + (fwd ? " Your router also forwards it to the internet." : " No device has asked your router to open it to the internet (we checked)."),
        fwd ? "High: it's reachable from the internet." : "Moderate: someone would need to be on your network, or another device on it would need to be infected first.",
        ["Open the device's app or settings page.", "Look for Telnet, Remote access or Debug mode and turn it off.", "If there is no switch, update the firmware: many makers removed Telnet in later versions.", "Run Porchlight again to confirm it's closed."], 10));
    }

    if (ports.includes(5555)) {
      out.push(finding("worth-fixing", d, "Android debugging is open to the network",
        `${name} accepts connections on the Android debugging port (ADB, port 5555). This is common on Android TV boxes and some phones.`,
        "On many devices this lets anyone on your network install apps and control the device without a password. Some ask for permission on screen first; many TV boxes don't.",
        "Moderate: it needs someone or something on your network, and malware that spreads between Android TV boxes looks for exactly this port.",
        ["On the device, open Settings → Developer options (or System → Advanced → Developer options).", "Turn off \"USB debugging\", \"Network debugging\" or \"ADB debugging\".", "If you can't find Developer options, the maker may have left it on by default: check for a firmware update.", "Run Porchlight again to confirm it's closed."], 5));
    }

    if (ports.includes(2375)) {
      out.push(finding("worth-fixing", d, "Docker can be controlled over the network without a password",
        `${name} accepts Docker remote-control connections on port 2375, the unencrypted one.`,
        "Docker on port 2375 normally has no password and no encryption: anyone on your network who connects can start programs on that computer with full control.",
        "Moderate: it needs someone on your network, but automated tools look for this port.",
        ["If you didn't set this up on purpose, turn it off: in Docker Desktop → Settings → General, untick \"Expose daemon on tcp://localhost:2375\" (or remove -H tcp://0.0.0.0:2375 from the Docker service).", "If you need remote access, use SSH or port 2376 with TLS certificates.", "Run Porchlight again."], 10));
    }

    if (d.rtsp?.state === "open") {
      const exposed = forwardedTo(mappings, d.ip, d.rtsp.port);
      out.push(finding(exposed ? "fix-soon" : "worth-fixing", d, "Camera video can be watched without a password",
        `${name} sends its live video to anyone who asks, without a password.`,
        exposed ? "Anyone on the internet who finds your address can watch this camera, because your router forwards its video port." : "Anyone connected to your Wi-Fi can open the video feed. No device has asked your router to open it to the internet (we checked); unless you set up a port forward for this camera yourself, people outside your home can't reach it.",
        exposed ? "High: internet-wide scanners look for exactly this." : "Moderate: it needs someone on your Wi-Fi, like a guest, a neighbour who knows the password, or an infected device.",
        ["Open the camera's app or web page.", "Go to Settings → Network or Security and turn on \"Authentication\" for RTSP (sometimes called \"RTSP password\" or \"Stream encryption\").", "If you don't use the camera with other apps, turn RTSP off completely.", "Run Porchlight again to confirm."], 5));
    } else if (d.rtsp?.state === "protected") {
      out.push(finding("all-good", d, "Camera video asks for a password", `${name} asks for a password before sharing its video.`, "That's how it should be.", "Nothing to do.", [], 0));
    }

    if (ports.includes(21)) {
      const sw = d.ftp ? ` (${d.ftp})` : "";
      out.push(finding("worth-fixing", d, "Old file-sharing service (FTP) is on",
        d.isRouter
          ? `Your router runs an FTP server${sw}. FTP is an old way of sharing files (usually a USB drive plugged into the router) that sends passwords and files unencrypted.`
          : `${name} runs an FTP server${sw}, an old way of sharing files that sends passwords and files unencrypted.`,
        "Someone on your network could read the FTP password while it's being used, then open the shared files.",
        "Low to moderate: it needs someone already on your network.",
        d.isRouter
          ? [`Open your router's settings page (http://${d.ip}) and log in.`, "Look under USB, Storage or File sharing and turn FTP off.", "If you do share a USB drive this way, keep it on but give it a strong password.", "Run Porchlight again."]
          : ["In the device's settings, turn off FTP.", "If you need file sharing, use SFTP or the device's app instead.", "Run Porchlight again."], 5));
    }

    if (ports.includes(34567)) {
      out.push(finding("worth-fixing", d, "Remote-viewing service with a history of security flaws",
        `${name} runs the \"XMEye\" remote-viewing service (port 34567), used by many low-cost cameras and recorders.`,
        "This service has had several serious, publicly known flaws. Older firmware is the main risk.",
        forwardedTo(mappings, d.ip, 34567) ? "High: it's reachable from the internet." : "Moderate: it's reachable only inside your network.",
        ["Update the recorder or camera firmware from the maker's website or app.", "In its settings, turn off \"Cloud\" / \"P2P\" access if you don't watch it away from home.", "Run Porchlight again."], 15));
    }

    if (ports.includes(5900)) {
      out.push(finding("worth-fixing", d, "Remote screen control (VNC) is on",
        `${name} lets people control its screen remotely (VNC).`,
        "Many VNC setups use a short password or none at all, which would let someone on your network see and control the screen.",
        "Moderate: it needs someone on your network.",
        ["If you don't use remote control, turn VNC off.", "If you do, set a long password (12+ characters).", "Run Porchlight again."], 5));
    }

    if (ports.includes(3389) && !d.self) {
      out.push(finding("good-to-know", d, "Windows Remote Desktop is on",
        `${name} accepts Remote Desktop connections.`,
        "That's fine inside your home as long as the Windows account has a strong password. It becomes risky only if your router forwards it to the internet" + (forwardedTo(mappings, d.ip, 3389) ? ", and right now it does." : ". No device has asked your router to do that (we checked); a port forward set up by hand wouldn't show here."),
        forwardedTo(mappings, d.ip, 3389) ? "High: Remote Desktop on the internet is constantly attacked." : "Low.",
        ["If you don't use it: Settings → System → Remote Desktop → Off.", "If you do: make sure the account password is strong."], 2));
    }

    if (ports.includes(1883)) {
      out.push(finding("good-to-know", d, "Smart-home messages are not encrypted",
        `${name} runs an MQTT server (smart-home messages) without encryption.`,
        "Devices on your network could read or send smart-home commands through it if it has no password.",
        "Low: it needs someone on your network.",
        ["In your smart-home hub's settings, make sure MQTT requires a username and password."], 5));
    }

    const kind = deviceKind(d);
    if (d.web && !d.isRouter && (kind === EXTENDER || kind === CAMERA)) {
      out.push(finding("good-to-know", d, `Make sure the ${kind === CAMERA ? "camera" : "Wi-Fi extender"} has its own admin password`,
        `${name} has a settings page at ${d.web.url}.`,
        "Anyone on your network can open that page. Porchlight never tries passwords, so it can't tell whether the factory password (often blank or \"admin\") is still set. Whoever knows it can change the device's settings.",
        "Low, once you've set your own password.",
        [`Open ${d.web.url} in a browser.`, "If it lets you in with no password or with \"admin\", set your own (12+ characters) in its System, Management or Admin settings."], 3));
    }
  }

  // Doors opened to the internet by devices themselves (UPnP).
  if (upnp?.router?.found) {
    const active = mappings.filter((m) => m.enabled);
    if (active.length === 0) {
      out.push(finding("good-to-know", null, "Your router lets devices open doors to the internet (UPnP), but none are open",
        "Your router has UPnP turned on: devices on your network can ask it to open a port to the internet without asking you.",
        "Nothing is open right now. Some game consoles and apps rely on it, so you don't have to turn it off.",
        "Low today.",
        ["Optional: in your router's settings, turn off UPnP if you don't play online games or use apps that need it.", "Run Porchlight again from time to time to see if anything opened a door."], 5));
    }
    for (const m of active) {
      const dev = devices.find((x) => x.ip === m.internalClient) || { ip: m.internalClient };
      const sensitive = [21, 23, 80, 554, 8000, 8080, 8554, 34567, 37777, 3389, 5900].includes(m.internalPort);
      out.push(finding(sensitive ? "fix-soon" : "worth-fixing", dev, "A device opened a door to the internet by itself",
        `${deviceName(dev)} asked your router to open port ${m.externalPort} (${m.protocol}) to the internet${m.description ? `, labelled "${m.description}"` : ""}. It leads to its ${COMMON_PORTS[m.internalPort]?.plain || `port ${m.internalPort}`}.`,
        sensitive ? "This service is now reachable by anyone on the internet, not just people in your home." : "A program or device on your network is reachable from the internet through this port. Games and video calls sometimes need this.",
        sensitive ? "High: internet-wide scanners look for exactly these services." : "Low to moderate, depending on what's listening.",
        ["If you don't recognise it: in your router's settings, turn off UPnP, then restart the device.", "If you do need it, keep that device's firmware up to date.", "Run Porchlight again to confirm the door is closed."], 5));
    }
  } else {
    const router = devices.find((x) => x.isRouter);
    if (router && upnp?.devices?.some((u) => u.ip === router.ip)) {
      out.push(finding("all-good", router, "Devices can't open doors to the internet on their own",
        "Your router answered our UPnP check but doesn't offer automatic port opening (UPnP-IGD is off).",
        "Programs and devices on your network can't open a way in from the internet without you setting it up. That's the safer setting.",
        "Nothing to do.", [], 0));
    }
  }

  // Router admin page.
  if (routerAdmin?.reachable) {
    if (!routerAdmin.https && !routerAdmin.redirectsToHttps) {
      out.push(finding("good-to-know", devices.find((x) => x.isRouter) || null, "Router settings page is not encrypted",
        `Your router's settings page${routerAdmin.title ? ` ("${routerAdmin.title}")` : ""} is only available over plain HTTP.`,
        "When you log in, your router password travels unencrypted across your home network.",
        "Low: someone would need to be on your network and watching at the moment you log in.",
        ["Make sure the router admin password is not the one printed on the sticker.", "Log into your router only from a wired computer or a trusted device."], 5));
    }
  }

  // Your Wi-Fi networks: protection, WPS, and copies of your network's name.
  out.push(...wifiFindings({ wifi, homeSsid, devices }));
  out.push(...lookalikeFindings({ wifi, homeSsid, devices }));

  // This computer's own firewall (Windows).
  if (firewall) {
    const me = devices.find((x) => x.self) || null;
    if (firewall.on) {
      out.push(finding("all-good", me, "This computer's firewall is on",
        `Windows Firewall is on for the network you're using (${firewall.profiles.join(", ")} profile).`,
        "Other devices on your network can only reach the programs on this computer that you've allowed.", "Nothing to do.", [], 0));
    } else {
      out.push(finding("worth-fixing", me, "This computer's firewall is off",
        `Windows Firewall is off for the network you're using (${firewall.profiles.join(", ")} profile).`,
        "Any program on this computer that listens for connections can be reached by every other device on your network, including ones you don't control.",
        "Low to moderate: it matters most if another device on your network is infected, or when you take this computer to other networks.",
        ["Open Start → Windows Security → Firewall & network protection.", "Click the network marked \"(active)\" and turn Microsoft Defender Firewall on.", "Run Porchlight again."], 2));
    }
  }

  // Wi-Fi adapters and monitor mode.
  for (const a of wifi?.adapters || []) {
    const chip = a.chipset;
    const desc = a.description || a.name;
    if (a.inMonitorMode) {
      out.push(finding("good-to-know", null, `${adapterLabel(a)} is in monitor mode`,
        `${desc} is in monitor mode right now: it is listening to all Wi-Fi traffic nearby instead of connecting to a network.`,
        "That's normal if you turned it on for testing. If you didn't, something on this computer did, and it's worth finding out what.",
        "Low, if you know why it's on.",
        [`If you're done testing, switch it back: sudo ip link set ${a.name} down; sudo iw dev ${a.name} set type managed; sudo ip link set ${a.name} up`], 1));
    } else if (a.monitorSupported) {
      out.push(finding("good-to-know", null, `${adapterLabel(a)} can do monitor mode (it's off)`,
        `${desc} supports monitor mode${a.inMonitorMode === false ? ", and it's switched off right now" : ""}.`,
        "Monitor mode lets an adapter listen to all Wi-Fi traffic nearby. It's useful for testing your own Wi-Fi; in normal use it stays off.",
        "Nothing to worry about.", [], 0));
    } else if (chip) {
      out.push(finding("good-to-know", null, `${adapterLabel(a)} can do monitor mode on Linux, not on Windows`,
        `${desc} uses a ${chip.chip} chip. Its Windows driver reports monitor mode as not supported, so it's off here.`,
        `The hardware can do it: ${chip.note}. On Windows it works as a normal Wi-Fi card.`,
        "Nothing to worry about.", [], 0));
    }
  }

  return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

export function summarize(findings) {
  const n = (lvl) => findings.filter((f) => f.level === lvl).length;
  const soon = n("fix-soon");
  const worth = n("worth-fixing");
  if (soon + worth === 0) return "Nothing needs fixing. A few notes are below if you're curious.";
  const parts = [];
  if (soon) parts.push(`${soon} to fix soon`);
  if (worth) parts.push(`${worth} worth fixing`);
  return `${parts.join(", ")}. Everything else looks fine.`;
}
