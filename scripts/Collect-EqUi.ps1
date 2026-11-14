<#
  Collect-EqUi.ps1 - run on the PC whose EverQuest setup you want looked at.

  Makes ONE zip on your Desktop holding the settings files UI Studio works with:
    eqclient.ini, zeal.ini, eqw.ini, the options files, and every character's
    UI_<Char>_pq.proj.ini, <Char>_pq.proj.ini, spell sets and socials files.

  Left out on purpose: chat logs (eqlog_*), your account name (equname.txt), trader price files,
  character exports and crash files. Chat-channel passwords are blanked in the COPIES; the files
  in your EverQuest folder are only read, never changed.

  How to run (Windows PowerShell):
    1. Save this file somewhere, for example your Desktop.
    2. Right-click it > Run with PowerShell.
       If Windows refuses to run scripts, open PowerShell and paste:
         powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Collect-EqUi.ps1"
    3. It finds the EverQuest folder by itself when the game is running; otherwise it asks.
       To name the folder yourself:
         powershell -ExecutionPolicy Bypass -File .\Collect-EqUi.ps1 -EqDir "D:\Games\Quarm"
#>
param([string]$EqDir)

$ErrorActionPreference = 'Stop'

function Test-EqDir([string]$d) { return ($d -and (Test-Path -LiteralPath (Join-Path $d 'eqclient.ini'))) }

# 1. Find the EverQuest folder: the running game, then a few usual places, then ask.
if (-not (Test-EqDir $EqDir)) {
  $EqDir = $null
  try {
    $p = Get-Process -Name eqgame -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
    if ($p) { $EqDir = Split-Path -Parent $p.Path }
  } catch { }
}
if (-not (Test-EqDir $EqDir)) {
  $EqDir = $null
  $drives = (Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root })
  foreach ($root in $drives) {
    foreach ($name in 'EQ', 'Quarm', 'EverQuest', 'Games\Quarm', 'Games\EQ', 'Project Quarm') {
      $c = Join-Path $root $name
      if (Test-EqDir $c) { $EqDir = $c; break }
    }
    if ($EqDir) { break }
  }
}
while (-not (Test-EqDir $EqDir)) {
  $EqDir = (Read-Host 'EverQuest folder (the one that holds eqgame.exe and eqclient.ini)').Trim('"', ' ')
  if (-not (Test-EqDir $EqDir)) { Write-Host '  No eqclient.ini in that folder. Try again, or press Ctrl+C to stop.' -ForegroundColor Yellow }
}
Write-Host "EverQuest folder: $EqDir"

# 2. Which files. Only names from this list are copied.
$patterns = @(
  'eqclient.ini', 'zeal.ini', 'eqw.ini', 'eqOptions1.opt', 'ss.opt',
  'UI_*_pq.proj.ini', '*_pq.proj.ini', '*spellsets*.ini', 'Sock_*.ini', 'Socials_*.ini'
)
$skip = '^(BZR_|eqlog_)'
$files = @{}
foreach ($pat in $patterns) {
  Get-ChildItem -LiteralPath $EqDir -Filter $pat -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch $skip } |
    ForEach-Object { $files[$_.Name.ToLower()] = $_ }
}
if ($files.Count -eq 0) { throw "Nothing to collect in $EqDir" }

# 3. Copy to a temp folder. Text files are read and rewritten with chat-channel passwords blanked.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$work = Join-Path $env:TEMP ("eq-ui-" + $stamp)
New-Item -ItemType Directory -Path $work | Out-Null
$enc = [System.Text.Encoding]::GetEncoding(1252)
$secret = '^([ \t]*[^=;#\[\r\n]*(password|ChannelAutoJoin)[^=\r\n]*=)[^\r\n]*'
$list = New-Object System.Collections.Generic.List[string]
foreach ($f in ($files.Values | Sort-Object Name)) {
  $dest = Join-Path $work $f.Name
  if ($f.Extension -ieq '.ini') {
    $text = [System.IO.File]::ReadAllText($f.FullName, $enc)
    $text = [regex]::Replace($text, $secret, '${1}REMOVED', 'IgnoreCase, Multiline')
    [System.IO.File]::WriteAllText($dest, $text, $enc)
  } else {
    Copy-Item -LiteralPath $f.FullName -Destination $dest
  }
  $list.Add(('{0,-44} {1,9} bytes  {2:yyyy-MM-dd HH:mm:ss}' -f $f.Name, $f.Length, $f.LastWriteTime))
}

# 4. A short note about this PC: its name, screen sizes, and the file list. No account or personal folders.
$info = New-Object System.Collections.Generic.List[string]
$info.Add("Collected $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') on $env:COMPUTERNAME")
try {
  Add-Type -AssemblyName System.Windows.Forms
  foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    $info.Add(("Screen: {0}x{1}{2}" -f $s.Bounds.Width, $s.Bounds.Height, $(if ($s.Primary) { ' (main)' } else { '' })))
  }
} catch { $info.Add('Screen sizes: could not be read') }
try {
  Get-CimInstance Win32_VideoController | ForEach-Object {
    $info.Add(("Video mode: {0}x{1} @ {2} Hz" -f $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution, $_.CurrentRefreshRate))
  }
} catch { }
$zealDll = Join-Path $EqDir 'Zeal.asi'
if (Test-Path -LiteralPath $zealDll) {
  $info.Add(("Zeal.asi: {0} bytes, {1:yyyy-MM-dd HH:mm}" -f (Get-Item -LiteralPath $zealDll).Length, (Get-Item -LiteralPath $zealDll).LastWriteTime))
}
$info.Add('')
$info.Add('Files:')
$info.AddRange($list)
[System.IO.File]::WriteAllLines((Join-Path $work '_about-this-pc.txt'), $info)

# 5. Zip it onto the Desktop.
$desktop = [Environment]::GetFolderPath('Desktop')
$zip = Join-Path $desktop ("eq-ui-" + $env:COMPUTERNAME + "-" + $stamp + ".zip")
Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force
Remove-Item -LiteralPath $work -Recurse -Force

Write-Host ''
Write-Host ("Done: {0} files" -f $files.Count) -ForegroundColor Green
Write-Host "Zip:  $zip"
Write-Host 'Chat-channel passwords were blanked in the copies. Send that zip.'
if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' | Out-Null }
