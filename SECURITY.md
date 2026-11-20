# Security and responsible use

## What Porchlight does on a network

Porchlight is a read-only checkup. On the network it checks, it:

- asks the computer's own neighbour table which devices are present, after sending one empty UDP packet to each
  address (or, for other ranges, opens TCP connections to a few common ports);
- opens TCP connections to a fixed list of common ports, one at a time per device in the home profile and up to four
  at a time in the office profile, and closes them;
- sends the opening message any client sends to some services, and reads the reply: HTTP `GET /`, RTSP `DESCRIBE`,
  SMB `NEGOTIATE` (SMB 2/3 and SMB 1), RDP connection request, TLS handshake, Redis `PING`, mDNS and NetBIOS name
  queries, and UPnP discovery and port-mapping listing;
- reads the Wi-Fi networks the computer can already hear (on Windows through the Wi-Fi API; on Linux through `iw`).

It never:

- sends a user name or password to anything, including default or "common" passwords;
- tries to exploit a vulnerability, or sends anything designed to crash or confuse a device;
- floods, deauthenticates, jams, or changes any setting;
- adds, removes or changes UPnP port mappings (it only lists them);
- sends results anywhere. Reports stay on the computer that ran the checkup.

## Scope rules built into the tool

- Without a range, it checks only the network the computer is on, after the person running it confirms it's theirs.
- Other ranges must be private address space (10/8, 172.16/12, 192.168/16), at most 4,096 addresses per run, and need
  the name of the person who authorised the check. That name is recorded in every report.

## Only check networks you're allowed to check

Scanning networks without permission may be illegal where you live. Use Porchlight on your own network, or on a
network whose owner has authorised you in writing.

## Reporting a problem in Porchlight

If you find a security problem in Porchlight itself (for example in the local panel), please open a GitHub issue
titled "Security" without exploit details, and you'll be given a private way to share them. The panel only listens
on 127.0.0.1 and checks the Host and Origin headers; reports of ways around that are especially welcome.
