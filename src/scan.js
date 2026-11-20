// Runs the whole checkup in order and reports progress. Every step is read-only.
import { findNetwork } from "./network.js";
import { discover } from "./discover.js";
import { scanPorts, pool, COMMON_PORTS } from "./ports.js";
import { checkRtsp } from "./rtsp.js";
import { upnpSurvey } from "./ssdp.js";
import { checkRouterAdmin } from "./router.js";
import { wifiSurvey, sameHardware } from "./wifi.js";
import { webIdentity, readBanner, ftpSoftware } from "./identify.js";
import { buildFindings, summarize, deviceName, deviceKind, ownNetworks } from "./findings.js";

export async function runCheckup({ homeSsid = null, onProgress = () => {} } = {}) {
  const started = new Date();
  onProgress("Finding your network");
  const net = await findNetwork();
  if (!net) throw new Error("This computer doesn't seem to be connected to a network.");

  onProgress("Looking for devices on your network");
  const devices = await discover(net);

  onProgress("Asking devices to describe themselves");
  const upnp = await upnpSurvey();
  for (const u of upnp.devices) {
    const d = devices.find((x) => x.ip === u.ip);
    if (d && !d.friendlyName) Object.assign(d, { friendlyName: u.friendlyName, manufacturer: u.manufacturer, modelName: u.modelName });
  }

  // The Wi-Fi survey only listens, so it runs while the devices are checked.
  const wifiPromise = wifiSurvey();
  onProgress(`Checking ${devices.length} devices for open doors`);
  await pool(devices, 8, async (d) => {
    d.ports = await scanPorts(d.ip);
    const rtspPort = [554, 8554].find((p) => d.ports.includes(p));
    if (rtspPort && !d.self) d.rtsp = { ...(await checkRtsp(d.ip, rtspPort)), port: rtspPort };
    if (!d.self) d.web = await webIdentity(d.ip, d.ports);
    if (d.ports.includes(21)) d.ftp = ftpSoftware(await readBanner(d.ip, 21));
  });

  onProgress("Looking at your router's settings page");
  const routerAdmin = await checkRouterAdmin(net.gateway);

  onProgress("Checking your Wi-Fi and adapters");
  const wifi = await wifiPromise;
  for (const d of devices) {
    if (d.self || !d.mac) continue;
    const b = [...new Set(wifi.aps.filter((a) => sameHardware(d.mac, a.bssid)).map((a) => a.ssid).filter(Boolean))];
    if (b.length) d.broadcasts = b;
  }

  const findings = buildFindings({ devices, upnp, routerAdmin, wifi, homeSsid });
  return {
    when: started.toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    network: { cidr: net.cidr, gateway: net.gateway, address: net.address, interface: net.interface, narrowed: net.narrowed },
    homeSsid,
    devices: devices.map((d) => ({ ip: d.ip, name: deviceName(d), kind: deviceKind(d), ports: d.ports || [], doors: (d.ports || []).map((p) => ({ port: p, name: COMMON_PORTS[p]?.name || String(p), plain: COMMON_PORTS[p]?.plain || `port ${p}` })), mac: d.mac || "", self: Boolean(d.self), isRouter: Boolean(d.isRouter), web: d.web?.url || null, broadcasts: d.broadcasts || [] })),
    wifi: {
      adapters: wifi.adapters,
      networks: wifi.networks.map((n) => n.ssid),
      yours: ownNetworks({ wifi, homeSsid, devices }).map((n) => ({ ssid: n.ssid, reason: n.reason, auth: n.auth || null, wps: n.aps.length ? n.aps.some((a) => a.wps) : null })),
      wpsCheckable: wifi.wpsCheckable,
    },
    upnp: { routerFound: upnp.router.found, mappings: upnp.router.mappings },
    summary: summarize(findings),
    findings,
  };
}
