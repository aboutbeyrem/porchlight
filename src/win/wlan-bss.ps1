# Porchlight helper (Windows): lists the Wi-Fi networks this computer can hear, with the raw beacon details
# ("information elements") the routers broadcast to everyone nearby. Read-only: it asks Windows for a fresh scan
# and reads the results. No admin rights needed, nothing is sent to any network.
# Output: one line per access point: SSID(hex) <TAB> BSSID <TAB> RSSI <TAB> IEs(hex)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PorchlightWlan {
  [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint v, IntPtr r, out uint n, out IntPtr h);
  [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr h, IntPtr r);
  [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern uint WlanScan(IntPtr h, ref Guid g, IntPtr ssid, IntPtr ie, IntPtr r);
  [DllImport("wlanapi.dll")] static extern uint WlanGetNetworkBssList(IntPtr h, ref Guid g, IntPtr ssid, int type, [MarshalAs(UnmanagedType.Bool)] bool sec, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

  static string Hex(byte[] b) { var s = new StringBuilder(b.Length * 2); foreach (var x in b) s.Append(x.ToString("x2")); return s.ToString(); }

  static Guid[] Interfaces(IntPtr h) {
    IntPtr list; if (WlanEnumInterfaces(h, IntPtr.Zero, out list) != 0) return new Guid[0];
    int n = Marshal.ReadInt32(list); var g = new Guid[n];
    for (int i = 0; i < n; i++) { var b = new byte[16]; Marshal.Copy(new IntPtr(list.ToInt64() + 8 + i * 532), b, 0, 16); g[i] = new Guid(b); }
    WlanFreeMemory(list); return g;
  }

  public static void Scan() {
    uint n; IntPtr h; if (WlanOpenHandle(2, IntPtr.Zero, out n, out h) != 0) return;
    foreach (var g in Interfaces(h)) { var x = g; WlanScan(h, ref x, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
    WlanCloseHandle(h, IntPtr.Zero);
  }

  public static string List() {
    var sb = new StringBuilder();
    uint n; IntPtr h; if (WlanOpenHandle(2, IntPtr.Zero, out n, out h) != 0) return "";
    foreach (var g in Interfaces(h)) {
      var x = g; IntPtr bl;
      if (WlanGetNetworkBssList(h, ref x, IntPtr.Zero, 3, false, IntPtr.Zero, out bl) != 0) continue;
      int count = Marshal.ReadInt32(bl, 4);
      for (int i = 0; i < count; i++) {
        long e = bl.ToInt64() + 8 + (long)i * 360;              // sizeof(WLAN_BSS_ENTRY) = 360
        int ssidLen = Math.Min(32, Marshal.ReadInt32(new IntPtr(e)));
        var ssid = new byte[ssidLen]; Marshal.Copy(new IntPtr(e + 4), ssid, 0, ssidLen);
        var mac = new byte[6]; Marshal.Copy(new IntPtr(e + 40), mac, 0, 6);
        int rssi = Marshal.ReadInt32(new IntPtr(e + 56));
        int ieOff = Marshal.ReadInt32(new IntPtr(e + 352)), ieSize = Marshal.ReadInt32(new IntPtr(e + 356));
        int cap = Marshal.ReadInt16(new IntPtr(e + 88)) & 0xffff;   // usCapabilityInformation (bit 4 = Privacy)
        var ie = new byte[Math.Max(0, Math.Min(ieSize, 8192))]; Marshal.Copy(new IntPtr(e + ieOff), ie, 0, ie.Length);
        sb.Append(Hex(ssid)).Append('\t').Append(BitConverter.ToString(mac).Replace('-', ':').ToLower()).Append('\t').Append(rssi).Append('\t').Append(Hex(ie)).Append('\t').Append(cap).Append('\n');
      }
      WlanFreeMemory(bl);
    }
    WlanCloseHandle(h, IntPtr.Zero);
    return sb.ToString();
  }
}
"@
# Windows empties the list while a scan runs, and one scan can miss a weaker access point (like an extender in
# another room). So: keep the cached list, run two scans, and merge everything heard (newest wins per BSSID).
$seen = [ordered]@{}
function Add-Lines($text) { foreach ($l in ($text -split "`n")) { $p = $l.Split("`t"); if ($p.Count -ge 4) { $seen[$p[1]] = $l } } }
Add-Lines ([PorchlightWlan]::List())
for ($round = 0; $round -lt 2; $round++) {
  [PorchlightWlan]::Scan()
  $fresh = ""
  for ($i = 0; $i -lt 16 -and $fresh.Length -eq 0; $i++) { Start-Sleep -Milliseconds 500; $fresh = [PorchlightWlan]::List() }
  Add-Lines $fresh
}
[Console]::Out.Write((@($seen.Values) -join "`n"))
