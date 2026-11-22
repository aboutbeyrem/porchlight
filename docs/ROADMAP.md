# Roadmap

Ideas for what Porchlight does next, grouped by what they give people. Nothing here is promised or dated.

Every idea has to pass Porchlight's one rule: **it looks; it never breaks in.** No logging in to routers, no password
guessing, no pushing devices off the network, nothing sent anywhere the user didn't choose. Ideas that would break
the rule are listed at the end with the reason.

Started 22 November 2026. ★ marks the ones that would make the biggest difference to a family on day one.

## Alerts wherever you are

- ★ **Phone apps** (Android first, then iPhone): alerts on your phone, and a view of who's home. Planned next.
- ★ **Telegram and Discord alerts**: a bot sends Porchlight's alerts to a chat you choose. Free, works on every phone
  today, and most families already have Telegram.
- **ntfy alerts**: the same through the free ntfy app, for people who want no account at all.
- **Weekly summary**: one calm notification on Sunday evening. "This week: 2 new devices, both yours. Nothing
  risky."
- **Home Assistant and MQTT**: publish devices and alerts so smart-home fans can use them in automations.

## Know your home better

- ★ **Router firmware check**: read the router's model and firmware version (from what it already announces) and say
  when it's old or has publicly known flaws, with the maker's update page.
- ★ **Known-flaw devices**: match each device's maker and model against a built-in, offline copy of CISA's Known
  Exploited Vulnerabilities list. "This camera model has a flaw attackers are using right now: update it."
- ★ **Comings and goings**: a timeline of when each device joins and leaves. A device that's only online at 3 a.m.,
  or a phone nobody recognises that appears every evening, stands out.
- **Family view**: group devices by person ("Sara's devices", "The living room") and get alerts per person.
- **Who's home** (opt-in): "Sara's phone just came home." Off by default, and it stays on this computer.
- **A device changed**: a device you know suddenly opens new doors or answers with a different name. Often the first
  sign it was taken over or reset.
- **Default network name**: names like "TP-Link_4F2A" or "Fibre_Box_XXXX" give away the router model and often mean
  the factory settings (and password) were never changed.
- **Guest network advice**: cameras, plugs and TVs are the easiest devices to break into. Spot them on your main
  network and show how to move them to the router's guest network.
- **Fake DHCP server**: a second device handing out network addresses, a known way to put a device in the middle of
  your traffic.

## Better Wi-Fi, not just safer Wi-Fi

- ★ **Wi-Fi channel advice**: Porchlight already hears every network nearby. "Five neighbours share channel 6 with
  you; channel 11 is almost empty." Free speed for most homes.
- ★ **Internet outage log**: note every time the internet drops and for how long. A clear record to show your
  internet provider ("14 cuts this month, 3 hours in total").
- **Signal by room**: walk around with the laptop and Porchlight draws where the Wi-Fi is strong and weak, and where
  an extender would help.
- **Wi-Fi password strength**: type your Wi-Fi password into Porchlight (it never leaves the computer) and see how
  long it would take to crack, with a button to make a strong one. Optional, never stored.
- **Share the guest Wi-Fi**: a QR code visitors scan to join the guest network, so the main password stays private.

## Away from home

- ★ **Networks you join elsewhere**: at a café, school or hotel, check that network too: open or weak protection,
  something pretending to be its router, a fake copy nearby. Suggest a VPN when it's risky.
- **VPN check**: is the VPN really on, and are website lookups (DNS) leaking around it?
- **Outside view**: with the user's OK, ask a small Porchlight service on the internet to check from outside which of
  your home's doors are really open. The only way to be sure a port forward is closed.

## Fixing things

- ★ **Router-specific steps**: fix guides with the real menu names for common routers (Tunisie Telecom, Ooredoo and
  Orange boxes, TP-Link, Huawei, Zyxel, Netgear...), picked from the router Porchlight detects.
- **"Explain like I'm new"**: a switch that rewrites every explanation in the simplest words, and a "more detail"
  switch for people who want the technical terms.
- **Score history**: a small chart of the home's score over time. Watching it climb is motivating.
- **Quiet streak**: "30 quiet days at home." A gentle reward, nothing gamified beyond that.

## Sharing and reports

- **One-click PDF report**: for a parent, a landlord or a small office, in the chosen language.
- **"My home is checked" card**: a shareable image with the score and date, no personal details.
- **Spreadsheet export** of every device (name, maker, address, first and last seen) for anyone keeping an inventory.

## For small offices and IT

- **Several sites in one view**: each office's Porchlight reports to one dashboard the IT person owns.
- **Scheduled reports by email** with what changed since last week.
- **Command line and JSON** for scripts, with the same checks as the app.

## Everywhere

- ★ **Porchlight Box**: the watcher on a Raspberry Pi or an old Android phone, so the home is watched 24/7 without a
  PC switched on.
- **Mac and Linux** versions (Tauri already supports both).
- **More languages**: Spanish, German, Turkish, Italian next. The translation system is already in place.

## Trust

- **A certificate Windows trusts** (Certum open-source, €49 a year) so SmartScreen stops warning. See
  [SIGNING.md](SIGNING.md).
- **Reproducible builds**: anyone can rebuild the installer from the source and get the same file.
- **An outside security review** of Porchlight itself.

## Ideas we won't do, and why

- **Kicking a device off the network** (ARP spoofing or deauthentication): that's an attack, even when it's aimed at
  an intruder. Porchlight shows how to remove the device from the router instead.
- **Logging in to the router to change settings**: it needs your router password and could break your internet.
  Porchlight explains the change and checks that it worked.
- **Trying passwords** on devices to find weak ones: guessing passwords on devices is what attackers do. Porchlight
  says which devices have a settings page and asks you to check.
- **Watching what people do online**: Porchlight protects the home, it doesn't spy on the people in it.
