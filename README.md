# Porchlight

**A security checkup for your home network, written for people who aren't in IT.**
It finds the devices on your network, looks for the handful of problems that actually get homes into trouble, and
explains each one in plain words: what we found, what it means, how likely it is to matter, and how to fix it.

It looks; it never breaks in. Windows and Linux.

![A sample Porchlight report of a made-up home: three things worth fixing, each explained in plain words with steps to fix it](docs/panel-sample.png)

*Sample report of a made-up home. Open `http://localhost:7377/?demo` to see it in the panel.*

## What it checks

| Check | What it tells you |
|---|---|
| **Devices on your network** | What's connected, named from what each device announces (UPnP, its web page title, your router's names). |
| **Open doors** | 15 common services: Telnet, FTP, VNC, Remote Desktop, MQTT, camera and recorder services, web pages. |
| **Cameras** | Whether a camera streams its video (RTSP) to anyone who asks, without a password. |
| **Doors opened to the internet** | Whether devices asked your router to open ports to the internet on their own (UPnP), and which. |
| **Router settings page** | Whether it's offered over an encrypted connection. |
| **Your Wi-Fi protection** | WPA3, WPA2, WPA, WEP or none, for your main network, a second network from the same router, and your extender's network. Never your neighbours'. |
| **WPS** | Whether your access points announce WPS, the PIN-based way to join, read from what they broadcast. |
| **Wi-Fi adapters and monitor mode** | Whether you have an adapter that can do monitor mode, and whether it's on right now. |

## How a finding reads

Every finding has four parts, and a level that's honest about urgency: **Fix soon**, **Worth fixing**,
**Good to know** or **All good**. Risk is described as "who would need to do what", never as a worst-case story.

> **WPS is on for "HomeNet-EXT"** (Worth fixing)
> **What we found:** "HomeNet-EXT" (broadcast by your PIX-LINK extender at 192.168.1.115) announces WPS, the "press a
> button or type an 8-digit PIN to connect" feature. WPS is already off on "HomeNet".
> **What that means:** The PIN part of WPS has a known design weakness: on some devices, someone within Wi-Fi range
> can work out the PIN with free tools and get the Wi-Fi password, however long it is. The push-button part is fine.
> **How likely it matters:** Low to moderate: it needs someone within range of your Wi-Fi, and it only works on some
> models. Turning WPS off costs nothing unless you connect devices with the WPS button.
> **How to fix it:** Open your extender's settings page and log in. Find WPS and turn it off. Run Porchlight again.

## What it never does

- **Only your network.** It checks the network this computer is on, and only after you confirm it's yours.
- **Never logs in.** No password guessing, no default-password tries, no cracking.
- **Never attacks.** No flooding, no deauthentication, no jamming. It checks one port at a time per device, so small
  devices keep working normally.
- **Nothing leaves your computer.** No account, no cloud, no tracking. The panel only answers on `localhost` and
  refuses requests from other websites.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer. Nothing else to install.

```bash
git clone https://github.com/aboutbeyrem/porchlight
cd porchlight
node bin/porchlight.js
```

Then open <http://localhost:7377>, confirm it's your home network, pick your Wi-Fi name, and start the checkup.
It takes about 30 seconds for a typical home.

Prefer the terminal:

```bash
node bin/porchlight.js --scan --this-is-my-network --wifi "Your Wi-Fi name"
```

Add `--json` for a machine-readable report.

**Windows** uses built-in tools (`route`, `arp`, `netsh`) and a small PowerShell helper,
[`src/win/wlan-bss.ps1`](src/win/wlan-bss.ps1), that reads Wi-Fi beacons through the Windows Wi-Fi API. No admin
rights needed.
**Linux** uses `ip`, `iw` and `nmcli` (NetworkManager), which most desktops already have.

## Honest limits

- It checks 15 common ports, not every port. It's a checkup, not a full audit.
- It never tries passwords, so it can't tell whether a device still has its factory password. It reminds you to check.
- Devices that are asleep or ignore everything (phones often do) may not show up.
- It covers one IPv4 network of up to 254 addresses. IPv6 isn't checked yet.
- It can't see port forwards you set up by hand in your router, only ones devices opened through UPnP.
- WPS and Wi-Fi protection are read from networks this computer can hear. An extender in another room may need a
  check from closer.
- On Windows, monitor-mode support comes from what the adapter's driver reports.
- **Linux:** the Linux code is covered by tests on sample command output, but it hasn't been run end to end on a Linux
  machine yet.
- **Not built yet:** the monitor-mode detectors from the plan (spotting deauthentication attacks and fake copies of
  your network). Today Porchlight reports whether you have a monitor-mode adapter and whether it's on.

## Tested on a real home

Run on a real home network (Windows 10, Ethernet, plus an ALFA AWUS036ACS USB Wi-Fi adapter). It found an FTP server
running on the router, found WPS switched on in a Wi-Fi extender while the main network had it off, named the
extender from its own web page, and confirmed that the router doesn't let devices open ports to the internet by
themselves.

Testing there also changed the design:

- The extender ignored every connection when eight arrived at once, which hid its open ports. Porchlight now checks
  one port at a time per device.
- A Windows scan sometimes missed the extender's network, and once that produced a false "no password" warning.
  Missing information is now always "unknown", never "open", and the protection type is read from what the access
  point itself broadcasts.

## Tests

```bash
npm test
```

40 tests: parsers for every command's output (English and French Windows), the rules and tone of every finding
(no scare words), fake cameras and FTP servers on `127.0.0.1`, and the panel's security (DNS rebinding, cross-site
requests, consent, path traversal).

## How it was made

The idea, the rules and the tone are mine, written down in [PLAN.md](PLAN.md) before any code, and I tested it on my
own home network. The code was written by Claude Code (an AI coding agent by Anthropic) working from that plan.

## License

MIT. See [LICENSE](LICENSE).

Made by [Beyrem Oueslati](https://www.aboutbeyrem.com).
