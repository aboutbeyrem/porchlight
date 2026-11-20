# Porchlight: a security checkup for your home network

> Working name. Porchlight = turning the light on so you can see what is around your house. Rename freely.

**One sentence:** Porchlight scans the network you are on, finds what a stranger could see or reach, and explains each
problem in plain language with the real risk and the exact fix.

**Who it is for:** someone with a router, a few cameras and smart devices, who has never heard of nmap and doesn't want to.

---

## The rules (what keeps it a checkup tool, never an attack tool)

1. **Only your network.** It scans the network this computer is connected to, nothing else. First screen: "Is this your
   home network?" with the network name. No answer, no scan.
2. **Look, don't break in.** It observes and asks devices what they expose. It never cracks passwords, never brute-forces
   logins, never sends deauthentication packets, never jams.
3. **Local only.** Results stay on the computer. Nothing is uploaded. The only optional internet lookup is "are there
   known problems with this device model?", and it sends the model name, never your data.
4. **Every finding has a fix.** If Porchlight can't tell you how to fix something, it doesn't report it.

## How it talks (the tone rule)

Each finding has four parts, in this order, and nothing in capitals or red:

| Part | Example |
|---|---|
| **What we found** | Your camera "IPC-Living-Room" streams video without asking for a password. |
| **What that means** | Anyone connected to your Wi-Fi can open the video feed. Someone outside your home can't, unless your router forwards it (we checked: it doesn't). |
| **How likely it matters** | Moderate. It needs someone on your Wi-Fi: a guest, a neighbour who knows the password, or a hacked device. |
| **How to fix it (5 minutes)** | 1. Open the camera app. 2. Settings → Security → "Require password for RTSP". 3. Run Porchlight again to confirm. |

**Levels:** `Fix soon` · `Worth fixing` · `Good to know` · `All good`. No "critical", no skulls, no countdowns.
Risk is described by **who would need to do what**, never by worst-case stories.

## Version 1: the first 8 checks

| # | Check | How (Linux first, then Windows) |
|---|---|---|
| 1 | **Devices on your network**: list, with maker and type ("Hikvision camera", "Samsung TV") | ARP table + MAC vendor lookup + mDNS/SSDP names |
| 2 | **Open doors on each device**: which services answer, in plain words ("remote login", "video stream", "web page") | Gentle TCP connect scan of common ports only |
| 3 | **Old unsafe services**: Telnet (23), FTP (21), SMBv1 | Port 23/21 answer; SMB dialect check |
| 4 | **Cameras streaming without a password** | RTSP (554/8554) `DESCRIBE` without credentials: does it return a stream description or ask for a login? |
| 5 | **Router opening doors to the internet by itself** (UPnP) | Ask the router (UPnP IGD) to list its port mappings: shows exactly which device opened which port to the outside |
| 6 | **Wi-Fi protection level**: WEP / WPA / WPA2 / WPA3, and whether WPS is on | Linux: `iw dev <if> scan` (security + WPS fields). Windows: `netsh wlan show interfaces` |
| 7 | **Router admin page still on factory settings**: login page reachable over plain HTTP, default hostname | HTTP fetch of the gateway, no login attempted |
| 8 | **Your Wi-Fi adapters and monitor mode** (see below) | Linux: `iw list` / `iw dev`. Windows: `netsh wlan show wirelesscapabilities` |

## Monitor mode

**What Porchlight reports:**
- **"Do you have an adapter that can do monitor mode?"** Lists each Wi-Fi adapter, its chipset, and whether it supports
  monitor mode (e.g. *"Alfa AWUS036ACS (Realtek RTL8812AU): monitor mode supported"*).
- **"Is any adapter in monitor mode right now?"** If yes, it says so plainly: *"This adapter is listening to all Wi-Fi
  traffic nearby. That's normal if you turned it on for testing. If you didn't, something on this computer did."*

**What monitor mode unlocks (only if you have the adapter and choose "Advanced checks"), all passive, listening only:**
- **Deauth attack detector**: notices if someone is kicking devices off *your* Wi-Fi (a common first step of an attack),
  and tells you when it happened and which of your devices were hit.
- **Fake-Wi-Fi detector (evil twin)**: spots a second network pretending to be yours (same name, different hardware).
- **Leaky devices**: shows which of your devices shout the names of networks they have joined before (phones and laptops
  do this), and how to turn it off.

Nothing in this mode transmits. It never deauths, never captures handshakes to crack.

## The panel

A local web page (opens at `http://localhost`), one screen:
- top: one plain sentence, e.g. *"3 things worth fixing, 1 to fix soon. Everything else looks fine."*
- a card per device (photo-free, icon + name), its findings inside, sorted `Fix soon` first
- a **"Fixed it, check again"** button on every finding (re-runs just that check)
- an export: a one-page PDF report you can show a family member or a technician

## Build plan

| Step | What | Rough time |
|---|---|---|
| 1 | Python engine: checks 1, 2, 6, 8 on Linux (test on Aether OS) | 1–2 weekends |
| 2 | Checks 3, 4, 5, 7 + the finding text for each (the plain-language part is half the work) | 2 weekends |
| 3 | Local web panel + PDF export | 1–2 weekends |
| 4 | Monitor-mode advanced checks (deauth + evil-twin detector) | 2 weekends |
| 5 | Windows support (Npcap) | later |

**Stack:** Python (scapy for ARP and Wi-Fi frames, plain sockets for port checks, `miniupnpc` for UPnP), FastAPI + a
small HTML page for the panel. Ship it inside Aether OS as a built-in app, which is a strong story: an OS that checks
your home for you.

**Tests:** like SimpleAV, every check has a test against a known setup (an old camera or a Raspberry Pi with Telnet on),
including the "all good" case, so it never reports a problem that isn't there.

## Later, maybe

- Known-vulnerability lookup by device model (CVE database, model name only, opt-in)
- "Is my camera still on its factory password?": only with explicit per-device consent, one known default per model,
  never a list. Decide carefully; it is the one check that logs into something.
- Notifications when a new device joins the network

## Not ever

Password cracking, brute force, deauthentication or jamming, scanning networks that aren't yours, uploading results.

---

*Timing: bac in June 2027, college applications due 1–15 January. Step 1 is a good winter-break project; the rest can
wait.*
