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

## 2. Code signing for Windows (to do)

This is what removes the "Windows protected your PC" screen. It needs a certificate tied to a real identity, so only
the maintainer can apply. Check each provider's current terms before applying; they change.

| Option | Cost | Notes |
| --- | --- | --- |
| [SignPath Foundation](https://signpath.org) | Free for open-source projects | Apply with the GitHub repository. Signing then runs in CI from the public source, which also proves the installer matches the code. Best fit for Porchlight. |
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
