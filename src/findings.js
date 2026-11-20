// Turns raw scan results into findings a non-technical person can act on.
// Every finding: what we found, what it means, how likely it matters, and how to fix it. No fear, no exaggeration:
// risk is described as "who would need to do what", never as a worst-case story.
import { COMMON_PORTS } from "./ports.js";
import { protectionLevel, sameHardware, sameRouter, beaconProtection, isAlfa } from "./wifi.js";

export const LEVELS = ["fix-soon", "worth-fixing", "good-to-know", "all-good"];
export const LEVEL_LABEL = { "fix-soon": "Fix soon", "worth-fixing": "Worth fixing", "good-to-know": "Good to know", "all-good": "All good" };

const CAMERA_PORTS = [554, 8554, 34567, 37777];

export const EXTENDER = "Wi-Fi extender or access point";
export const CAMERA = "camera or recorder";

export function deviceKind(d) {
  const text = `${d.friendlyName || ""} ${d.manufacturer || ""} ${d.modelName || ""} ${d.hostname || ""} ${d.web?.title || ""}`.toLowerCase();
  if (d.isRouter) return "router";
  if (d.self) return "this computer";
  if (/camera|ipc|nvr|dvr|hikvision|dahua|reolink|ezviz|imou|tapo c|xiongmai|netcam/.test(text) || d.ports?.some((p) => CAMERA_PORTS.includes(p))) return CAMERA;
  if (d.broadcasts?.length || /pix-?link|repeater|extender|range ?ext|mesh wi-?fi|access point/.test(text)) return EXTENDER;
  if (/tv|bravia|roku|chromecast|fire ?tv|android ?tv|webos|tizen/.test(text)) return "TV or streaming device";
  if (/printer|epson|canon|brother|hp ?(deskjet|laserjet|officejet)/.test(text)) return "printer";
  if (/iphone|ipad|android|galaxy|redmi|xiaomi|oppo|huawei|pixel|phone/.test(text)) return "phone or tablet";
  if (d.ports?.includes(3389) || d.ports?.includes(445)) return "computer";
  return "device";
}

export function deviceName(d) {
  if (d.self) return "This computer";
  if (d.isRouter) return d.friendlyName ? `Your router (${d.friendlyName})` : "Your router";
  const label = d.friendlyName || d.web?.label || d.hostname?.replace(/\.(lan|home|local|localdomain)$/i, "");
  return label ? `${label} (${d.ip})` : `${capitalize(deviceKind(d))} at ${d.ip}`;
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function finding(level, device, title, found, means, likely, fix, minutes) {
  return { level, device: device?.ip || null, deviceName: device ? deviceName(device) : null, title, found, means, likely, fix, minutes };
}

function forwardedTo(mappings, ip, port) {
  return mappings.find((m) => m.enabled && m.internalClient === ip && (port === undefined || m.internalPort === port));
}

// Which of the Wi-Fi networks this computer can hear are yours: the one you named (or are connected to), a second
// name from the same router (guest, 5 GHz), one whose name extends yours ("HomeNet-EXT"), or one broadcast
// by a device we found on your network (an extender). Neighbours' networks are never reported on.
export function ownNetworks({ wifi, homeSsid, devices = [] }) {
  const connected = wifi?.adapters?.find((a) => a.connected);
  const home = connected?.ssid || homeSsid || null;
  const aps = wifi?.aps || [];
  const nets = wifi?.networks || [];
  const names = new Set([...nets.map((n) => n.ssid), ...aps.map((a) => a.ssid), connected?.ssid].filter(Boolean));
  const homeBssids = aps.filter((a) => a.ssid === home).map((a) => a.bssid);
  const out = [];
  for (const ssid of names) {
    const its = aps.filter((a) => a.ssid === ssid);
    const device = devices.find((d) => !d.self && !d.isRouter && d.mac && its.some((a) => sameHardware(d.mac, a.bssid)));
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
    if (fix) out.push(finding(fix[0], net.device, fix[1], `${fix[1]}${where(net)}.`, fix[2], fix[3], fix[4], 10));
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
      out.push(finding("worth-fixing", net.device, `WPS is on for "${net.ssid}"`,
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

export function buildFindings({ devices, upnp, routerAdmin, wifi, homeSsid }) {
  const out = [];
  const mappings = upnp?.router?.mappings || [];

  for (const d of devices) {
    const name = deviceName(d);
    const ports = d.ports || [];

    if (ports.includes(23)) {
      out.push(finding("fix-soon", d, "Old remote-login service (Telnet) is on",
        `${name} accepts Telnet, an old way to log into a device remotely.`,
        "Telnet sends passwords as readable text, and it is the main door automated attacks use to take over cameras and routers. Right now it can only be reached from inside your home network" + (forwardedTo(mappings, d.ip, 23) ? ", but your router also forwards it to the internet." : "."),
        forwardedTo(mappings, d.ip, 23) ? "High: it's reachable from the internet." : "Moderate: someone would need to be on your network, or another device on it would need to be infected first.",
        ["Open the device's app or settings page.", "Look for Telnet, Remote access or Debug mode and turn it off.", "If there is no switch, update the firmware: many makers removed Telnet in later versions.", "Run Porchlight again to confirm it's closed."], 10));
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

  // Your Wi-Fi networks: protection and WPS.
  out.push(...wifiFindings({ wifi, homeSsid, devices }));

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
