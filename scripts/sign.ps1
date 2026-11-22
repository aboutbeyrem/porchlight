# Code-signs one file during the Tauri build (bundle.windows.signCommand runs this for the app, the installer and
# the uninstaller).
#
# Which certificate: $env:PORCHLIGHT_SIGN_THUMBPRINT if set (for example a Certum "Open Source Developer"
# certificate through SimplySign Desktop), otherwise the "Porchlight code signing" certificate in this user's
# certificate store. The current one is self-signed by the maintainer: it proves the files weren't changed after
# signing, but Windows doesn't know the issuer, so SmartScreen still says "Unknown publisher" until Porchlight has a
# certificate from an authority Windows trusts. Its public half is docs/porchlight-codesign.cer.
#
# Without any certificate (on GitHub's build machines, for example) the build still works and the files are left
# unsigned.
param([Parameter(Mandatory = $true)][string]$File)

$thumb = $env:PORCHLIGHT_SIGN_THUMBPRINT
if (-not $thumb) {
  $thumb = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq "Porchlight code signing" -and $_.NotAfter -gt (Get-Date) } |
    Select-Object -First 1).Thumbprint
}
if (-not $thumb) {
  Write-Host "Not code-signing $(Split-Path $File -Leaf): no Porchlight code-signing certificate on this computer"
  exit 0
}
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "signtool.exe not found: install the Windows SDK" }

# The timestamp keeps the signature valid after the certificate expires.
& $signtool.FullName sign /sha1 $thumb /fd sha256 /tr http://timestamp.digicert.com /td sha256 /d Porchlight /du https://porchlight-beryl.vercel.app $File
if ($LASTEXITCODE -ne 0) { throw "Code signing failed for $File" }
Write-Host "Signed $(Split-Path $File -Leaf)"
