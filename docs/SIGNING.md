# Signing and trust

Porchlight has two kinds of signatures. One is done; the other needs a person with an identity behind it.

## 1. Update signatures (done)

Every release is signed with Porchlight's own update key (minisign, through the Tauri updater). The matching public
key is built into the app, so an installed Porchlight only installs an update whose signature matches. Someone who
took over the website still couldn't push a fake update.

- Private key: `%USERPROFILE%\.tauri\porchlight-updater.key`, with its password in `porchlight-updater.password`
  next to it. **Never commit them.** Back both up somewhere offline (a USB stick). If they're lost, installed copies
  can't be updated any more and everyone has to reinstall once.
- Release build (PowerShell, from `app/`):

  ```powershell
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\porchlight-updater.key"
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content -Raw "$env:USERPROFILE\.tauri\porchlight-updater.password"
  npx @tauri-apps/cli@2 build
  ```

- Then `npm run build:site` writes `updates/latest.json` (version, signature, download address) next to the
  installer, and the site deploy publishes both.

## 2. Code signing for Windows

**Now: signed by the author.** Every build made on the maintainer's PC signs the app, the installer, the
uninstaller and the installer's plugins (`scripts/sign.ps1`, run by `bundle.windows.signCommand`). The certificate
is self-signed: "CN=Beyrem Oueslati, O=Porchlight", SHA-1 thumbprint `6250EBA6F952FFD7AAB36CC154ECC1DB1CA1C486`,
valid until November 2031, timestamped by DigiCert so signatures stay valid after it expires. Its public half is
[porchlight-codesign.cer](porchlight-codesign.cer). The private key is in this user's certificate store, with a
password-protected copy (`%USERPROFILE%\.tauri\porchlight-codesign.pfx` + `.password`) and an offline backup.
**Never commit them.**

Check a download in PowerShell: `Get-AuthenticodeSignature .\Porchlight_<version>_x64-setup.exe | Format-List`.
The signer's thumbprint must match the one above. Windows reports the status as "UnknownError" because it doesn't
know the issuer: that's expected for a self-signed certificate.

**What it doesn't do:** remove SmartScreen's "Windows protected your PC". Only a certificate from an authority
Windows trusts does that. To switch, set `$env:PORCHLIGHT_SIGN_THUMBPRINT` to the new certificate before building;
nothing else changes.

**Note:** SignPath Foundation's free certificates exclude "security diagnosis tools that actively scan for and
highlight exploitable vulnerabilities, e.g. by identifying unprotected network ports, missing password protection",
which describes Porchlight, so that route is closed. The realistic options are below.

### Getting a trusted certificate (to do)

This is what removes the "Windows protected your PC" screen. It needs a certificate tied to a real identity, so only
the maintainer can apply. Check each provider's current terms before applying; they change.

| Option | Cost | Notes |
| --- | --- | --- |
| [Certum Open Source Code Signing](https://shop.certum.eu/open-source-code-signing-on-simplysign.html) | €49 a year in the cloud (€69 with a card and reader), November 2026 prices | Issued to a person ("Open Source Developer, name"), with an ID document. Works with `scripts/sign.ps1` through SimplySign Desktop. Best fit for Porchlight. |
| [SignPath Foundation](https://signpath.org) | Free for open-source projects | Excludes vulnerability-scanning tools (see above). |
| Microsoft Store | Free account for individual developers (check current terms) | The Store handles distribution and trust; needs an MSIX package or a signed installer. |
| Azure Trusted Signing | Monthly fee | Requires identity validation and is only available in some countries. |
| A classic OV/EV certificate | Yearly fee | Works everywhere; EV builds SmartScreen reputation fastest. |

Even with a signature, SmartScreen reputation grows with downloads, so the warning can take a little while to
disappear completely.

### SignPath, step by step

1. Read the requirements on signpath.org (an OSI license, a public repository, a release built by CI).
2. Add a GitHub Actions workflow that builds the installer on a tagged release (`npx @tauri-apps/cli@2 build` on
   `windows-latest`). Keep the update key as an encrypted repository secret.
3. Apply for the free Foundation certificate with the repository link.
4. Once accepted, add SignPath's signing step to the workflow after the build and before uploading the release.
