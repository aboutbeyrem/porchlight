// Runs the whole checkup in order and reports progress. Every step is read-only.
import { findNetwork } from "./network.js";
import { discover } from "./discover.js";
import { scanPorts, pool, COMMON_PORTS, PROFILES, portsFor } from "./ports.js";
import { checkRtsp } from "./rtsp.js";
import { upnpSurvey } from "./ssdp.js";
import { checkRouterAdmin } from "./router.js";
import { wifiSurvey, sameHardware } from "./wifi.js";
import { webIdentity, readBanner, ftpSoftware, vendorOf } from "./identify.js";
import { queryMdns, summarizeMdns, reverseMdns, netbiosName } from "./mdns.js";
import { checkSmb, checkRdp, checkTls, checkRedis, checkMysql, checkElastic } from "./protocols.js";
import { firewallStatus } from "./system.js";
import { parseRanges, tcpAlive } from "./ranges.js";
import { loadHistory, saveHistory, networkKey, compare, updateEntry } from "./history.js";
import { annotate } from "./catalog.js";
import { knownName, applyAccepted, failsPolicy } from "./policy.js";
import { buildFindings, changeFindings, inventoryFindings, summarize, scoreOf, deviceName, deviceKind, ownNetworks, LEVELS } from "./findings.js";

const EMPTY_WIFI = { platform: null, adapters: [], networks: [], aps: [], wpsCheckable: false };

export async function runCheckup({ homeSsid = null, onProgress = () => {}, history = true, profile = null, policy = null, ranges = null, authorizedBy = null } = {}) {
  const started = new Date();
  profile = profile || policy?.profile || "home";
  const settings = PROFILES[profile] || PROFILES.home;
  const ports = portsFor(profile, policy?.extraPorts || []);

  onProgress("Finding your network");
  const net = await findNetwork();
  if (!net) throw new Error("This computer doesn't seem to be connected to a network.");

  // Scope: this computer's network, or the ranges an office authorised.
  const wanted = ranges?.length ? ranges : policy?.ranges?.length ? policy.ranges : null;
  let scope = [net.cidr];
  let authorization = null;
  let localHosts = net.hosts;
  let remoteHosts = [];
  if (wanted) {
    const by = authorizedBy || policy?.authorizedBy;
    if (!by) throw new Error("Checking other ranges needs the name of the person who authorised it (--authorized-by or \"authorizedBy\" in the policy).");
    const parsed = parseRanges(wanted);
    scope = parsed.cidrs;
    authorization = { by, ranges: parsed.cidrs, at: started.toISOString() };
    const local = new Set(net.hosts);
    localHosts = parsed.hosts.filter((h) => local.has(h));
    remoteHosts = parsed.hosts.filter((h) => !local.has(h));
  }

  onProgress("Looking for devices on your network");
  const devices = localHosts.length ? await discover({ ...net, hosts: localHosts }) : [{ ip: net.address, mac: "", self: true }];
  if (remoteHosts.length) {
    onProgress(`Looking for devices in ${remoteHosts.length} addresses`);
    const alive = await tcpAlive(remoteHosts, { onProgress: (n, total) => onProgress(`Looking for devices (${n} of ${total} addresses)`) });
    for (const ip of alive) if (!devices.some((d) => d.ip === ip)) devices.push({ ip, mac: "" });
  }

  // The Wi-Fi survey only listens, so it runs while everything else happens.
  const wifiPromise = wifiSurvey().catch(() => EMPTY_WIFI);

  onProgress("Asking devices to describe themselves");
  const [upnp, mdnsRecords] = await Promise.all([upnpSurvey(net.address), queryMdns(net.address)]);
  const mdns = summarizeMdns(mdnsRecords);
  for (const u of upnp.devices) {
    const d = devices.find((x) => x.ip === u.ip);
    if (d && !d.friendlyName) Object.assign(d, { friendlyName: u.friendlyName, manufacturer: u.manufacturer, modelName: u.modelName });
  }
  await pool(devices.filter((d) => !d.self), 8, async (d) => {
    const [nb, rev] = await Promise.all([netbiosName(d.ip), mdns[d.ip]?.name ? null : reverseMdns(d.ip)]);
    if (mdns[d.ip]) d.mdns = mdns[d.ip];
    if (rev) d.mdns = { ...(d.mdns || { kind: null, model: null, services: [] }), host: rev };
    if (nb) d.netbios = nb;
    d.vendor = vendorOf(d.mac);
    d.knownName = knownName(policy, d);
  });

  onProgress(`Checking ${devices.length} devices for open doors`);
  await pool(devices, profile === "office" ? 16 : 8, async (d) => {
    d.ports = await scanPorts(d.ip, ports, undefined, settings);
    const has = (p) => d.ports.includes(p);
    const rtspPort = [554, 8554].find(has);
    if (rtspPort && !d.self) d.rtsp = { ...(await checkRtsp(d.ip, rtspPort)), port: rtspPort };
    if (!d.self) d.web = await webIdentity(d.ip, d.ports);
    if (has(21)) d.ftp = ftpSoftware(await readBanner(d.ip, 21));
    if (has(445)) d.smb = await checkSmb(d.ip);
    if (has(3389)) d.rdp = await checkRdp(d.ip);
    if (profile === "office") {
      for (const p of [443, 8443].filter(has)) (d.tls ||= {})[p] = await checkTls(d.ip, p);
    }
    if (has(6379)) d.redis = await checkRedis(d.ip);
    if (has(3306)) d.mysql = await checkMysql(d.ip);
    if (has(9200)) d.elastic = await checkElastic(d.ip);
  });

  // Cheap Wi-Fi repeaters give every device connected through them the repeater's own MAC address. When several
  // addresses share one MAC, the one that answers (its settings page, open ports) is the repeater; the rest are
  // devices connected through it.
  const byMac = new Map();
  for (const d of devices) if (d.mac && !d.self && !d.isRouter) byMac.set(d.mac, [...(byMac.get(d.mac) || []), d]);
  for (const group of byMac.values()) {
    if (group.length < 2) continue;
    const host = group.find((d) => d.web?.label) || group.find((d) => d.ports?.length) || group[0];
    for (const d of group) {
      d.sharedMac = true;
      if (d !== host) d.behind = host.ip;
    }
  }

  onProgress("Looking at your router's settings page");
  const [routerAdmin, firewall] = await Promise.all([localHosts.includes(net.gateway) ? checkRouterAdmin(net.gateway) : null, firewallStatus()]);

  onProgress("Checking your Wi-Fi and adapters");
  const wifi = await wifiPromise;
  for (const d of devices) {
    if (d.self || !d.mac || d.behind) continue;
    const b = [...new Set(wifi.aps.filter((a) => sameHardware(d.mac, a.bssid)).map((a) => a.ssid).filter(Boolean))];
    if (b.length) d.broadcasts = b;
  }

  const findings = buildFindings({ devices, upnp, routerAdmin, wifi, homeSsid, firewall, profile });
  findings.push(...inventoryFindings(devices, policy));

  annotate(findings, devices);

  // What changed since last time (stored on this computer only).
  let changes = null;
  if (history) {
    const h = loadHistory();
    const key = networkKey({ cidr: scope.join(","), gateway: net.gateway }, devices);
    const heard = new Set([...wifi.aps.map((a) => a.ssid), ...wifi.networks.map((n) => n.ssid), ...wifi.adapters.map((a) => a.ssid)].filter(Boolean));
    changes = compare(h.networks[key], devices, findings, heard, { profile, inventory: Boolean(policy?.knownDevices?.length) });
    findings.push(...changeFindings(changes));
    h.networks[key] = updateEntry(h.networks[key], devices, findings, started.toISOString(), deviceName, changes.unverified);
    saveHistory(h);
  }

  annotate(findings, devices);
  applyAccepted(findings, devices, policy);
  findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || Boolean(a.accepted) - Boolean(b.accepted));

  return {
    tool: "porchlight",
    when: started.toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    profile,
    organization: policy?.organization || null,
    scope,
    authorization,
    network: { cidr: net.cidr, gateway: net.gateway, address: net.address, interface: net.interface, narrowed: net.narrowed },
    homeSsid,
    score: scoreOf(findings),
    failOn: policy?.failOn || null,
    failed: failsPolicy(findings, policy?.failOn),
    changes: changes && { firstRun: changes.firstRun, since: changes.since, newDevices: changes.newDevices.map((d) => d.ip), fixed: changes.fixed.map((p) => p.title) },
    devices: devices.map((d) => ({
      ip: d.ip,
      name: deviceName(d),
      kind: deviceKind(d),
      vendor: d.vendor || null,
      ports: d.ports || [],
      doors: (d.ports || []).map((p) => ({ port: p, name: COMMON_PORTS[p]?.name || String(p), plain: COMMON_PORTS[p]?.plain || `port ${p}` })),
      mac: d.mac || "",
      self: Boolean(d.self),
      isRouter: Boolean(d.isRouter),
      known: Boolean(d.knownName),
      web: d.web?.url || null,
      broadcasts: d.broadcasts || [],
      isNew: Boolean(changes?.newDevices.includes(d)),
    })),
    wifi: {
      adapters: wifi.adapters,
      networks: wifi.networks.map((n) => n.ssid),
      yours: ownNetworks({ wifi, homeSsid, devices }).map((n) => ({ ssid: n.ssid, reason: n.reason, auth: n.auth || null, wps: n.aps.length ? n.aps.some((a) => a.wps) : null, device: n.device?.ip || null })),
      wpsCheckable: wifi.wpsCheckable,
    },
    upnp: { routerFound: upnp.router.found, mappings: upnp.router.mappings },
    summary: summarize(findings),
    findings,
  };
}
