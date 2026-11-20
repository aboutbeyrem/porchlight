# Porchlight check catalog

Every finding has a stable ID, so it can be tracked in tickets, accepted in a policy file, or filtered in a CSV
export. Severity comes from the finding level (fix soon = high, worth fixing = medium, good to know = low, all good =
pass), and anything a device opened to the internet is raised to **critical**.

The CIS Controls v8 column lists the safeguards each check relates to. That mapping is Porchlight's own reading of
the safeguards, not a certification by the Center for Internet Security.

Regenerate this file with `node scripts/make-catalog.js`.

| ID | What it means | CIS Controls v8 | References | Profile |
|---|---|---|---|---|
| `PL-TELNET` | Telnet sends logins in clear text and is the main way botnets take over cameras and routers. | CIS 4.8, CIS 3.10 | CWE-319 | both |
| `PL-FTP` | FTP sends logins and files in clear text. | CIS 4.8, CIS 3.10 | CWE-319 | both |
| `PL-SMB1` | SMB version 1 is accepted. | CIS 4.8 | MS17-010, CVE-2017-0144 | both |
| `PL-SMB-SIGNING` | SMB signing is not required, which allows relay attacks. | CIS 4.1 | MITRE ATT&CK T1557.001 | office |
| `PL-RDP-NLA` | Remote Desktop accepts connections without Network Level Authentication. | CIS 4.1 | CVE-2019-0708 | both |
| `PL-RDP-ON` | Remote Desktop is enabled on another computer. | CIS 4.8 | — | home |
| `PL-VNC` | VNC remote control is reachable. | CIS 4.8 | — | both |
| `PL-ADB` | Android Debug Bridge is reachable over the network. | CIS 4.8 | CWE-306 | both |
| `PL-DOCKER` | The Docker API is exposed without TLS on port 2375. | CIS 4.8, CIS 4.1 | CWE-306 | both |
| `PL-RTSP-OPEN` | An RTSP camera stream answers without authentication. | CIS 4.1, CIS 3.3 | CWE-306 | both |
| `PL-RTSP-OK` | An RTSP camera stream requires authentication. | — | — | both |
| `PL-XMEYE` | The XMEye/Xiongmai DVR service (port 34567) is reachable. | CIS 4.8, CIS 7.4 | — | both |
| `PL-MQTT` | An MQTT broker without TLS is reachable. | CIS 3.10 | CWE-319 | both |
| `PL-DEFAULT-PASSWORD` | A device with a settings page; factory passwords can't be ruled out without trying them, which Porchlight never does. | CIS 4.7 | — | both |
| `PL-TLS-OLD` | TLS 1.0 or 1.1 is accepted. | CIS 3.10 | RFC 8996 | both |
| `PL-CERT-EXPIRED` | A TLS certificate has expired. | CIS 3.10 | — | office |
| `PL-CERT-EXPIRING` | A TLS certificate expires within 30 days. | CIS 3.10 | — | office |
| `PL-CERT-SELFSIGNED` | A TLS certificate is self-signed. | CIS 3.10 | — | office |
| `PL-CERT-WEAKKEY` | A TLS certificate key is shorter than 2048 bits. | CIS 3.10 | — | office |
| `PL-REDIS-NOAUTH` | Redis answers PING without authentication. | CIS 3.3, CIS 4.1 | CWE-306 | both |
| `PL-ELASTIC-NOAUTH` | Elasticsearch answers without authentication. | CIS 3.3, CIS 4.1 | CWE-306 | both |
| `PL-MEMCACHED` | Memcached is reachable. | CIS 3.3, CIS 4.8 | CWE-306 | both |
| `PL-DB-REACHABLE` | A database port is reachable from the scanned network. | CIS 12.2, CIS 4.4 | — | office |
| `PL-UPNP-MAPPING` | A device created a port forward through UPnP. | CIS 4.2, CIS 12.2 | — | both |
| `PL-UPNP-ON` | UPnP port forwarding is enabled, with nothing forwarded. | CIS 4.2 | — | both |
| `PL-UPNP-OFF` | UPnP port forwarding is off. | — | — | both |
| `PL-ROUTER-HTTP` | The router's admin page is only available over HTTP. | CIS 12.6, CIS 3.10 | CWE-319 | both |
| `PL-WIFI-OPEN` | A Wi-Fi network of yours is open. | CIS 12.6 | — | both |
| `PL-WIFI-WEP` | A Wi-Fi network of yours uses WEP. | CIS 12.6 | — | both |
| `PL-WIFI-WPA` | A Wi-Fi network of yours uses WPA (version 1). | CIS 12.6 | — | both |
| `PL-WIFI-TKIP` | A Wi-Fi network of yours uses WPA2 with TKIP. | CIS 12.6 | — | both |
| `PL-WIFI-OK` | Your Wi-Fi networks use WPA2 or WPA3. | — | — | both |
| `PL-WIFI-UNSEEN` | The named Wi-Fi network wasn't heard from this computer. | — | — | both |
| `PL-WPS` | An access point of yours announces WPS. | CIS 4.2, CIS 12.6 | CVE-2011-5053 | both |
| `PL-WPS-OFF` | Your access points don't announce WPS. | — | — | both |
| `PL-EVIL-TWIN` | An access point that isn't yours broadcasts your network name with weaker protection. | — | — | both |
| `PL-SSID-DUPLICATE` | An access point that isn't tied to you broadcasts your network name. | — | — | both |
| `PL-EVIL-TWIN-OK` | No other access point broadcasts your network name. | — | — | both |
| `PL-FIREWALL` | Windows Firewall is off for the active network. | CIS 4.5 | — | both |
| `PL-FIREWALL-OK` | Windows Firewall is on for the active network. | — | — | both |
| `PL-MONITOR-ON` | A Wi-Fi adapter on this computer is in monitor mode. | — | — | both |
| `PL-MONITOR-CAPABLE` | A Wi-Fi adapter on this computer supports monitor mode. | — | — | both |
| `PL-NEW-DEVICE` | A device appeared that previous checkups hadn't seen. | CIS 1.1, CIS 1.2 | — | both |
| `PL-UNKNOWN-DEVICE` | A device isn't in the policy's list of known devices. | CIS 1.1, CIS 1.2 | — | both |
| `PL-FIXED` | Problems from the previous checkup that are gone now. | — | — | both |
