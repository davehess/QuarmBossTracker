<#
mimic-netdiag.ps1 — one-shot network / Mimic / EverQuest diagnostic bundle.

WHY (Hitya, 2026-09-07): Ashieron reported "when I zone out the game hangs,
disconnects, then my internet completely goes down; adapter looks active; only a
restart fixes it; doesn't happen without Mimic." The bot's own logs showed his
machine polling normally at 2 requests/second right up to a clean, total cut at
20:32:47 ET — which rules OUT Mimic exhausting sockets (that failure keeps
existing connections alive) and points at the box itself. Everything that can
settle it lives on the PC: the Windows event logs around the cut, Mimic's own
agent.log, the adapter's driver and power settings, and a socket count taken
WHILE it is broken. This script collects all of it into one zip, read-only.

HOW TO RUN (Windows 10/11, no admin needed — some details are richer as admin):
  Double-click mimic-netdiag.bat next to this file, or from PowerShell:
    powershell -ExecutionPolicy Bypass -File .\mimic-netdiag.ps1
  Options:
    -Since "2026-09-07 20:00"   start of the window to pull logs for (default: 3h ago)
    -Until "2026-09-07 21:30"   end of the window (default: now)
    -Live                      ALSO take the live network snapshot — run this
                               WHILE the internet is "down", before rebooting
    -Watch                     background mode: log socket/handle counts every
                               20s to Desktop\mimic-netwatch.csv until Ctrl+C.
                               Leave it running minimized while you play; the
                               next failure is then recorded as it happens.
    -NoPrompt                  skip the three questions at the end
  Output: Desktop\mimic-netdiag-<date>.zip  → send it to Hitya.

WHAT IT DOES NOT DO: change anything. It reads. The only writes are the report
folder and zip on your Desktop. Your Mimic token is redacted from the copied
config. Chat lines are stripped from every log excerpt; only zone / connection /
crash lines from the EQ log are included.

⚠ The bundle DOES contain your machine name, local IPs and adapter details.
That is the point — it is for the officer looking into your report, not for a
public channel.
#>
[CmdletBinding()]
param(
  [datetime]$Since = (Get-Date).AddHours(-3),
  [datetime]$Until = (Get-Date),
  [switch]$Live,
  [switch]$Watch,
  [switch]$NoPrompt,
  [string]$OutDir = ""
)

$ErrorActionPreference = 'Continue'
$VERSION = '1.0.0'
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $OutDir) { $OutDir = Join-Path $desktop ("mimic-netdiag-" + (Get-Date -Format 'yyyyMMdd-HHmm')) }

# ── helpers ─────────────────────────────────────────────────────────────────
function Find-MimicData {
  foreach ($n in @('Wolf Pack Mimic', 'wolfpack-mimic')) {
    $p = Join-Path $env:APPDATA $n
    if (Test-Path (Join-Path $p 'mimic.config.json')) { return $p }
  }
  foreach ($n in @('Wolf Pack Mimic', 'wolfpack-mimic')) {
    $p = Join-Path $env:APPDATA $n
    if (Test-Path $p) { return $p }
  }
  return $null
}
function Read-Config($dataDir) {
  if (-not $dataDir) { return $null }
  $f = Join-Path $dataDir 'mimic.config.json'
  if (-not (Test-Path $f)) { return $null }
  try { return (Get-Content -Raw -LiteralPath $f | ConvertFrom-Json) } catch { return $null }
}
# Recursively blank any key that looks like a credential.
function Redact($obj) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Collections.IDictionary]) {
    $out = @{}
    foreach ($k in $obj.Keys) { $out[$k] = (Redact-Key $k $obj[$k]) }
    return $out
  }
  if ($obj -is [PSCustomObject]) {
    $out = [ordered]@{}
    foreach ($p in $obj.PSObject.Properties) { $out[$p.Name] = (Redact-Key $p.Name $p.Value) }
    return $out
  }
  if ($obj -is [System.Array]) { return @($obj | ForEach-Object { Redact $_ }) }
  return $obj
}
function Redact-Key($name, $value) {
  if ($name -match 'token|secret|passw|apikey|api_key|cookie|auth|bearer') {
    if ($null -eq $value -or "$value" -eq '') { return $value }
    return '<redacted>'
  }
  return (Redact $value)
}
# Chat never leaves a member's machine through the agent; keep that promise here.
$chatRx = "tells? (you|the guild|the group|the raid|the party)|You told|You tell|says?, '|shouts?, '|auctions?, '|ooc, '|\[[0-9]+\.[^\]]+\]|tells [A-Za-z]+:|Officer"
function Strip-Chat([string[]]$lines) { return @($lines | Where-Object { $_ -notmatch $chatRx }) }

$script:report = New-Object System.Text.StringBuilder
function W([string]$s = '') { [void]$script:report.AppendLine($s); Write-Host $s }
function H([string]$s) { W ''; W ('=' * 78); W ("  " + $s); W ('=' * 78) }
function Section([string]$title, [scriptblock]$body) {
  H $title
  try { & $body } catch { W ("  !! section failed: " + $_.Exception.Message) }
}
function Save([string]$name, $content) {
  try {
    $p = Join-Path $OutDir $name
    if ($content -is [string]) { Set-Content -LiteralPath $p -Value $content -Encoding UTF8 }
    else { $content | Out-File -LiteralPath $p -Encoding UTF8 -Width 400 }
  } catch { W ("  !! could not save " + $name + ": " + $_.Exception.Message) }
}
function Fmt($t) { if ($t) { return (Get-Date $t -Format 'yyyy-MM-dd HH:mm:ss') } else { return '' } }

# ── WATCH MODE: run in the background while playing ─────────────────────────
if ($Watch) {
  $csv = Join-Path $desktop 'mimic-netwatch.csv'
  if (-not (Test-Path $csv)) {
    'time,total_tcp,established,time_wait,syn_sent,top_pid,top_pid_name,top_pid_conns,mimic_conns,agent_conns,eq_conns,discord_conns,mimic_handles,agent_handles,eq_handles,gw_ms,dns_ok,bot443_ok' | Set-Content -LiteralPath $csv
  }
  Write-Host "Watching every 20s → $csv   (Ctrl+C to stop; leave this window minimized while you play)"
  $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
  while ($true) {
    try {
      $c = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)
      $byPid = $c | Group-Object OwningProcess | Sort-Object Count -Descending
      $top = $byPid | Select-Object -First 1
      $topName = ''; try { $topName = (Get-Process -Id $top.Name -ErrorAction Stop).ProcessName } catch {}
      $procs = Get-Process -ErrorAction SilentlyContinue
      $pick = { param($rx) $procs | Where-Object { $_.ProcessName -match $rx } }
      $mimic = & $pick '^Wolf Pack Mimic|^wolfpack-mimic'
      $agent = & $pick '^node$'
      $eq    = & $pick '^eqgame'
      $disc  = & $pick '^Discord'
      $conns = { param($ps) if (-not $ps) { return 0 }; $ids = @($ps | ForEach-Object { $_.Id }); return @($c | Where-Object { $ids -contains $_.OwningProcess }).Count }
      $handles = { param($ps) if (-not $ps) { return 0 }; return (($ps | Measure-Object HandleCount -Sum).Sum) }
      $gwMs = ''; if ($gw) { try { $r = Test-Connection -ComputerName $gw -Count 1 -ErrorAction Stop; $gwMs = $r.ResponseTime } catch { $gwMs = 'FAIL' } }
      $dnsOk = 'n'; try { if (Resolve-DnsName 'wolfpackparse.up.railway.app' -ErrorAction Stop -DnsOnly) { $dnsOk = 'y' } } catch {}
      $botOk = 'n'; try { if ((Test-NetConnection 'wolfpackparse.up.railway.app' -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)) { $botOk = 'y' } } catch {}
      $line = @(
        (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $c.Count,
        @($c | Where-Object State -eq 'Established').Count,
        @($c | Where-Object State -eq 'TimeWait').Count,
        @($c | Where-Object State -eq 'SynSent').Count,
        $top.Name, $topName, $top.Count,
        (& $conns $mimic), (& $conns $agent), (& $conns $eq), (& $conns $disc),
        (& $handles $mimic), (& $handles $agent), (& $handles $eq),
        $gwMs, $dnsOk, $botOk
      ) -join ','
      Add-Content -LiteralPath $csv -Value $line
      Write-Host $line
    } catch { Write-Host ("watch tick failed: " + $_.Exception.Message) }
    Start-Sleep -Seconds 20
  }
}

# ── BUNDLE MODE ──────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

H "mimic-netdiag v$VERSION"
W ("  run at:   " + (Fmt (Get-Date)) + "   (local time, " + [TimeZoneInfo]::Local.DisplayName + ")")
W ("  window:   " + (Fmt $Since) + "  →  " + (Fmt $Until))
W ("  live:     " + $Live + "    admin: " + $isAdmin)
W "  contains machine name, local IPs and adapter details — for the officer only."

$dataDir = Find-MimicData
$cfg = Read-Config $dataDir

Section "1. System" {
  $os = Get-CimInstance Win32_OperatingSystem
  W ("  computer:   " + $env:COMPUTERNAME)
  W ("  OS:         " + $os.Caption + " " + $os.Version + " (build " + $os.BuildNumber + ")")
  W ("  last boot:  " + (Fmt $os.LastBootUpTime) + "   ← a boot inside the window = the restart")
  W ("  PowerShell: " + $PSVersionTable.PSVersion)
  try {
    $ps = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Wolf Pack Mimic|^wolfpack-mimic|^node$|^eqgame|^Discord$|^electron' } |
      Select-Object ProcessName, Id, StartTime, CPU, @{n='WS_MB';e={[math]::Round($_.WorkingSet64/1MB)}}, HandleCount, @{n='Threads';e={$_.Threads.Count}}
    W "  relevant processes now:"
    $ps | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { W $_ }
  } catch {}
}

if (-not $NoPrompt) {
  Section "2. Your answers" {
    W "  (three questions no log can answer — press Enter to skip any)"
    $q1 = Read-Host "  When it happens, do OTHER devices in the house (phone on wifi, another PC) lose internet too? (yes/no/don't know)"
    $q2 = Read-Host "  What brought it back last time — full PC restart, disable/enable the adapter, router reboot, or it came back on its own?"
    $q3 = Read-Host "  Which character were you on, and which zone were you leaving / entering?"
    W ("  other devices affected: " + $q1)
    W ("  what fixed it:          " + $q2)
    W ("  character / zone:       " + $q3)
  }
}

Section "3. Mimic" {
  if (-not $dataDir) { W "  Mimic data folder NOT found under %APPDATA% (looked for 'Wolf Pack Mimic' and 'wolfpack-mimic')"; return }
  W ("  data folder: " + $dataDir)
  $exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter '*.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -match 'Mimic' } | Select-Object -First 1
  if ($exe) { W ("  Mimic exe:   " + $exe.FullName + "   version " + $exe.VersionInfo.ProductVersion) }
  if ($cfg) {
    W ("  zealPipe:       " + $(if ($null -eq $cfg.zealPipe) { '(default: on)' } else { $cfg.zealPipe }))
    W ("  zealRawCapture: " + $cfg.zealRawCapture)
    W ("  crashReports:   " + $cfg.crashReports)
    W ("  eqPath:         " + $cfg.eqPath)
    W ("  botUrl:         " + $cfg.botUrl)
    Save 'mimic.config.redacted.json' ((Redact $cfg) | ConvertTo-Json -Depth 8)
    W "  config copied with credentials redacted → mimic.config.redacted.json"
  } else { W "  mimic.config.json missing or unreadable" }
  W ""
  W "  files in the data folder:"
  Get-ChildItem -LiteralPath $dataDir -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object @{n='path';e={$_.FullName.Substring($dataDir.Length+1)}}, @{n='KB';e={[math]::Round($_.Length/1KB)}}, LastWriteTime |
    Sort-Object LastWriteTime -Descending | Select-Object -First 40 |
    Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { W $_ }
  # agent.log: the [zeal] connect/drop lines and upload-queue errors are the story.
  foreach ($name in @('agent.log', 'agent.log.1')) {
    $f = Join-Path $dataDir $name
    if (-not (Test-Path $f)) { continue }
    $lines = Get-Content -LiteralPath $f -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    $tail = Strip-Chat ($lines | Select-Object -Last 3000)
    Save ("$name.tail.txt") ($tail -join "`n")
    $hits = Strip-Chat ($lines | Select-String -Pattern '\[zeal\]|\[upload-queue\]|\[mimic\]|\[updater\]|ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|ENOTFOUND|EPERM|error|fail|disconnect|hang' -CaseSensitive:$false | ForEach-Object { $_.Line })
    Save ("$name.highlights.txt") ($hits -join "`n")
    W ("  " + $name + ": " + $lines.Count + " lines; last 3000 saved; " + $hits.Count + " highlighted lines (zeal / upload-queue / errors) saved")
  }
  $q = Join-Path $dataDir 'agent\logsync.queue.json'
  if (Test-Path $q) {
    try { $qj = Get-Content -Raw -LiteralPath $q | ConvertFrom-Json; $n = @($qj).Count; if ($qj.PSObject.Properties['items']) { $n = @($qj.items).Count }
          W ("  upload queue: " + $n + " pending item(s), " + [math]::Round((Get-Item $q).Length/1KB) + " KB  (contents NOT included)") } catch { W "  upload queue present (unparsed)" }
  }
  $raw = Join-Path $dataDir 'zeal-raw.ndjson'
  if (Test-Path $raw) { W ("  zeal-raw.ndjson present: " + [math]::Round((Get-Item $raw).Length/1MB) + " MB (raw pipe capture is ON — not included)") }
}

Section "4. EverQuest + Zeal" {
  $eq = $null
  if ($cfg -and $cfg.eqPath -and (Test-Path $cfg.eqPath)) { $eq = $cfg.eqPath }
  if (-not $eq) { W "  EQ folder unknown (no eqPath in Mimic config)"; return }
  W ("  EQ folder: " + $eq)
  $g = Join-Path $eq 'eqgame.exe'
  if (Test-Path $g) { $gi = Get-Item $g; W ("  eqgame.exe: " + $gi.VersionInfo.FileVersion + "  modified " + (Fmt $gi.LastWriteTime)) }
  foreach ($z in (Get-ChildItem -Path $eq -Include 'Zeal*.asi','Zeal*.dll','zeal*.asi','zeal*.dll' -Recurse -Depth 1 -ErrorAction SilentlyContinue)) {
    W ("  " + $z.Name + ": " + $z.VersionInfo.FileVersion + "  modified " + (Fmt $z.LastWriteTime))
  }
  # Compatibility-mode / run-as-admin flags on eqgame.exe — XP compat mode is a
  # known Zeal-pipe breaker (EPERM); elevation mismatch is another.
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $k = "$hive\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"
    try {
      $v = Get-ItemProperty -Path $k -ErrorAction Stop
      foreach ($p in $v.PSObject.Properties) { if ($p.Name -match 'eqgame|Wolf Pack Mimic') { W ("  compat flags (" + $hive + "): " + $p.Name + " = " + $p.Value) } }
    } catch {}
  }
  # Crash bundles Zeal wrote inside the window.
  $cr = Join-Path $eq 'crashes'
  if (Test-Path $cr) {
    $bundles = Get-ChildItem -LiteralPath $cr -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $Since.AddHours(-1) -and $_.LastWriteTime -le $Until.AddHours(1) }
    W ("  crash bundles in window: " + @($bundles).Count)
    foreach ($b in $bundles) { W ("    " + $b.Name + "  " + [math]::Round($b.Length/1KB) + " KB  " + (Fmt $b.LastWriteTime)) }
    $latest = Get-ChildItem -LiteralPath $cr -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    foreach ($b in $latest) {
      # crash_reason.txt is small and has no chat in it — include it.
      try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($b.FullName)
        $e = $zip.Entries | Where-Object { $_.Name -eq 'crash_reason.txt' } | Select-Object -First 1
        if ($e) { $sr = New-Object System.IO.StreamReader($e.Open()); Save ("crash_reason_" + $b.BaseName + ".txt") ($sr.ReadToEnd()); $sr.Close() }
        $zip.Dispose()
      } catch {}
    }
  }
  # EQ logs touched in the window: ONLY zone / connection / crash lines, never chat.
  $logs = Get-ChildItem -Path (Join-Path $eq 'Logs') -Filter 'eqlog_*.txt' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $Since }
  foreach ($lf in $logs) {
    $sel = Get-Content -LiteralPath $lf.FullName -ErrorAction SilentlyContinue | Select-String -Pattern 'LOADING, PLEASE WAIT|You have entered|disconnected|Welcome to EverQuest|You have been|lost connection|Zone|zone server|crash' -CaseSensitive:$false | ForEach-Object { $_.Line }
    $sel = Strip-Chat $sel
    $win = @($sel | Where-Object {
      if ($_ -match '^\[(\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2} \d{4})\]') { try { $t = [datetime]::ParseExact($Matches[1], 'ddd MMM dd HH:mm:ss yyyy', [Globalization.CultureInfo]::InvariantCulture); ($t -ge $Since -and $t -le $Until) } catch { $true } } else { $true }
    })
    Save ("eqlog_zone-events_" + $lf.BaseName + ".txt") ($win -join "`n")
    W ("  " + $lf.Name + ": " + $win.Count + " zone/connection lines in window saved (chat excluded)")
  }
}

Section "5. Windows event logs (window)" {
  $filt = @{ LogName = 'System'; StartTime = $Since; EndTime = $Until }
  $sys = @(Get-WinEvent -FilterHashtable $filt -ErrorAction SilentlyContinue)
  $want = $sys | Where-Object {
    ($_.Level -ge 1 -and $_.Level -le 3) -or
    $_.ProviderName -match 'Tcpip|NDIS|Netw|WLAN|Dhcp|DNS|e1[dfr]|e2f|rt64|rtwlan|Killer|Qualcomm|Realtek|Intel|Broadcom|Marvell|Kernel-Power|Kernel-PnP|EventLog|Power-Troubleshooter|Wlan|NetBT|Winsock|afd|http' -or
    $_.Id -in @(41,42,107,1074,6005,6006,6008,6013,10000,10001,4201,4202,27,32)
  }
  W ("  System log: " + $sys.Count + " events in window, " + @($want).Count + " kept (errors/warnings + network/power/boot sources)")
  $want | Sort-Object TimeCreated | Select-Object @{n='time';e={Fmt $_.TimeCreated}}, @{n='lvl';e={$_.LevelDisplayName}}, ProviderName, Id, @{n='msg';e={ ($_.Message -replace '\s+', ' ').Substring(0, [math]::Min(220, ($_.Message -replace '\s+', ' ').Length)) }} |
    Format-Table -AutoSize | Out-String -Width 320 | Set-Content -LiteralPath (Join-Path $OutDir 'events_system.txt')
  $want | Sort-Object TimeCreated | ForEach-Object { "----- " + (Fmt $_.TimeCreated) + "  " + $_.LevelDisplayName + "  " + $_.ProviderName + "  id=" + $_.Id + "`n" + $_.Message + "`n" } | Set-Content -LiteralPath (Join-Path $OutDir 'events_system_full.txt')
  # The 12 most telling ones inline.
  $want | Where-Object { $_.Level -le 2 -or $_.Id -in @(41,6008,1074,10001,4202,27) } | Sort-Object TimeCreated | Select-Object -Last 12 | ForEach-Object {
    W ("    " + (Fmt $_.TimeCreated) + "  " + $_.LevelDisplayName + "  " + $_.ProviderName + "  id=" + $_.Id + "  " + (($_.Message -replace '\s+', ' ').Substring(0, [math]::Min(140, ($_.Message -replace '\s+', ' ').Length))))
  }
  $app = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $Since; EndTime = $Until } -ErrorAction SilentlyContinue) |
    Where-Object { $_.Id -in @(1000,1001,1002) -or $_.Message -match 'eqgame|Mimic|wolfpack|Zeal|node\.exe|Discord' }
  W ("  Application log: " + @($app).Count + " crash/hang/WER or EQ/Mimic-related events kept")
  $app | Sort-Object TimeCreated | ForEach-Object { "----- " + (Fmt $_.TimeCreated) + "  " + $_.LevelDisplayName + "  " + $_.ProviderName + "  id=" + $_.Id + "`n" + $_.Message + "`n" } | Set-Content -LiteralPath (Join-Path $OutDir 'events_application.txt')
  foreach ($op in @('Microsoft-Windows-NetworkProfile/Operational', 'Microsoft-Windows-WLAN-AutoConfig/Operational', 'Microsoft-Windows-Dhcp-Client/Operational', 'Microsoft-Windows-NDIS/Operational', 'Microsoft-Windows-Kernel-Power/Thermal-Operational')) {
    try {
      $ev = @(Get-WinEvent -FilterHashtable @{ LogName = $op; StartTime = $Since; EndTime = $Until } -ErrorAction Stop)
      W ("  " + $op + ": " + $ev.Count + " events")
      $ev | Sort-Object TimeCreated | ForEach-Object { (Fmt $_.TimeCreated) + "  id=" + $_.Id + "  " + (($_.Message -replace '\s+', ' ').Substring(0, [math]::Min(200, ($_.Message -replace '\s+', ' ').Length))) } |
        Set-Content -LiteralPath (Join-Path $OutDir ('events_' + ($op -replace '[^A-Za-z]+', '_') + '.txt'))
    } catch { if ($_.Exception.Message -match 'No events') { W ("  " + $op + ": 0 events") } else { W ("  " + $op + ": not available") } }
  }
  try {
    $rel = Get-CimInstance Win32_ReliabilityRecords -ErrorAction Stop | Where-Object { $_.TimeGenerated -ge $Since -and $_.TimeGenerated -le $Until } | Sort-Object TimeGenerated
    W ("  Reliability history: " + @($rel).Count + " records in window")
    $rel | ForEach-Object { (Fmt $_.TimeGenerated) + "  " + $_.SourceName + "  " + $_.ProductName + "  " + (($_.Message -replace '\s+', ' ').Substring(0, [math]::Min(200, ($_.Message -replace '\s+', ' ').Length))) } | Set-Content -LiteralPath (Join-Path $OutDir 'reliability.txt')
  } catch { W "  Reliability history: not available" }
}

Section "6. Network configuration" {
  Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name, InterfaceDescription, Status, LinkSpeed, MacAddress, DriverVersion, DriverDate, DriverProvider, MediaType |
    Format-Table -AutoSize | Out-String -Width 250 | ForEach-Object { W $_ }
  W "  adapter power management (a NIC allowed to sleep is a classic 'link looks up, nothing moves'):"
  Get-NetAdapterPowerManagement -ErrorAction SilentlyContinue | Select-Object Name, AllowComputerToTurnOffDevice, DeviceSleepOnDisconnect, SelectiveSuspend, WakeOnMagicPacket |
    Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { W $_ }
  foreach ($a in (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up')) {
    Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue | Select-Object DisplayName, DisplayValue |
      Format-Table -AutoSize | Out-String -Width 200 | Set-Content -LiteralPath (Join-Path $OutDir ('adapter_advanced_' + ($a.Name -replace '[^A-Za-z0-9]+', '_') + '.txt'))
  }
  Save 'ipconfig_all.txt' (ipconfig /all)
  Save 'route_print.txt' (route print)
  Save 'netsh_dynamicport.txt' ((netsh int ipv4 show dynamicport tcp) + (netsh int ipv6 show dynamicport tcp))
  Save 'netsh_winsock_catalog.txt' (netsh winsock show catalog)
  Save 'netsh_tcp_global.txt' (netsh int tcp show global)
  W "  TCP dynamic port range (fewer than ~16k ports here means exhaustion is easy):"
  (netsh int ipv4 show dynamicport tcp) | ForEach-Object { W ("    " + $_) }
  W "  Tcpip registry tweaks (guides hand these out; they shrink headroom):"
  try {
    $t = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -ErrorAction Stop
    foreach ($n in @('TcpTimedWaitDelay','MaxUserPort','TcpNumConnections','Tcp1323Opts','EnableTCPA','DefaultTTL')) { if ($null -ne $t.$n) { W ("    " + $n + " = " + $t.$n) } }
  } catch {}
  try {
    Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces' -ErrorAction Stop | ForEach-Object {
      $ip = Get-ItemProperty $_.PSPath
      foreach ($n in @('TcpAckFrequency','TCPNoDelay','TcpDelAckTicks')) { if ($null -ne $ip.$n) { W ("    interface " + $_.PSChildName.Substring(0,8) + "…  " + $n + " = " + $ip.$n) } }
    }
  } catch {}
  $lsp = (netsh winsock show catalog) | Select-String 'Provider|Description' | ForEach-Object { $_.Line.Trim() } | Where-Object { $_ -notmatch 'Microsoft|MSAFD|RSVP|Hyper-V|NLA' }
  W ("  non-Microsoft Winsock catalog entries: " + @($lsp).Count + "  (third-party LSPs are a known 'reboot fixes it' source)")
  @($lsp) | Select-Object -First 10 | ForEach-Object { W ("    " + $_) }
  try { $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop; foreach ($p in $av) { W ("  antivirus: " + $p.displayName + "  state=" + $p.productState) } } catch {}
  try { W ("  power plan: " + ((powercfg /getactivescheme) -join ' ')) } catch {}
  try { $hb = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -ErrorAction Stop).HiberbootEnabled; W ("  Fast Startup (HiberbootEnabled): " + $hb + "   (1 = a 'restart' that is really a resume; adapters can come back wrong)") } catch {}
}

Section "7. Sockets now" {
  W ("  live mode: " + $Live + "   — run with -Live WHILE it is broken for this section to mean the most")
  $c = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)
  W ("  total TCP connections: " + $c.Count)
  $c | Group-Object State | Sort-Object Count -Descending | ForEach-Object { W ("    " + $_.Name.PadRight(14) + $_.Count) }
  W "  connections per process (top 15):"
  $c | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object {
    $nm = ''; try { $nm = (Get-Process -Id $_.Name -ErrorAction Stop).ProcessName } catch { $nm = '?' }
    W ("    pid " + $_.Name.ToString().PadRight(7) + $nm.PadRight(22) + $_.Count)
  }
  Save 'netstat_ano.txt' (netstat -ano)
  Save 'tcp_connections.txt' ($c | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess, CreationTime | Sort-Object CreationTime | Format-Table -AutoSize | Out-String -Width 200)
  $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
  W ("  default gateway: " + $gw)
  if ($gw) { try { $r = Test-Connection -ComputerName $gw -Count 2 -ErrorAction Stop; W ("  ping gateway:  ok  " + ($r | Select-Object -Last 1).ResponseTime + " ms") } catch { W "  ping gateway:  FAIL" } }
  try { $r = Test-Connection -ComputerName '1.1.1.1' -Count 2 -ErrorAction Stop; W ("  ping 1.1.1.1:  ok  " + ($r | Select-Object -Last 1).ResponseTime + " ms   (by IP — works with DNS dead)") } catch { W "  ping 1.1.1.1:  FAIL   (link or router)" }
  try { $d = Resolve-DnsName 'wolfpackparse.up.railway.app' -DnsOnly -ErrorAction Stop; W ("  DNS resolve bot: ok  → " + (($d | Where-Object { $_.Type -in @('A','CNAME') } | Select-Object -First 1).IPAddress)) } catch { W "  DNS resolve bot: FAIL   (DNS dead while pings work = resolver problem)" }
  try { $d = Resolve-DnsName 'discord.com' -DnsOnly -ErrorAction Stop; W "  DNS resolve discord.com: ok" } catch { W "  DNS resolve discord.com: FAIL" }
  try { $t = Test-NetConnection 'wolfpackparse.up.railway.app' -Port 443 -WarningAction SilentlyContinue -ErrorAction Stop; W ("  TCP 443 to the bot: " + $(if ($t.TcpTestSucceeded) { 'ok' } else { 'FAIL' })) } catch { W "  TCP 443 to the bot: FAIL" }
  Save 'arp.txt' (arp -a)
  $csv = Join-Path $desktop 'mimic-netwatch.csv'
  if (Test-Path $csv) { Copy-Item -LiteralPath $csv -Destination (Join-Path $OutDir 'mimic-netwatch.csv'); W ("  included mimic-netwatch.csv (" + (Get-Content $csv).Count + " rows) from the -Watch run") }
}

# ── finish ───────────────────────────────────────────────────────────────────
H "done"
Save 'report.txt' $script:report.ToString()
$zip = "$OutDir.zip"
try { if (Test-Path $zip) { Remove-Item $zip -Force }; Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $zip -Force; W ("  bundle: " + $zip) } catch { W ("  zip failed (" + $_.Exception.Message + ") — send the folder instead: " + $OutDir) }
W "  Send the zip to Hitya. It contains your machine name, local IPs and adapter details — not for a public channel."
try { Start-Process explorer.exe -ArgumentList ("/select,`"" + $zip + "`"") } catch {}
