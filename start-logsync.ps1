# start-logsync.ps1 — Watch all recently-active EQ log files and stream encounter
# data to the Wolf Pack bot.
#
# On first run this script copies itself into your EQ directory (which is
# typically excluded from Windows Defender), then stores all config and runs
# from there. The repo copy is only needed once to bootstrap.
#
# Flags:
#   -Setup           Re-run the startup wizard (change service/shortcut preference)
#   -Remove          Remove the scheduled task and any shortcuts
#   -Reset           Forget all saved settings and start over
#   -DryRun          Parse locally, print encounter summaries — nothing uploaded
#   -StaleAfterDays  How many days back to look for active log files (default 30)
#   -EqDir           Override the EQ directory without re-prompting

param(
    [string] $EqDir          = "",
    [int]    $StaleAfterDays = 30,
    [switch] $DryRun,
    [switch] $Reset,
    [switch] $Setup,
    [switch] $Remove
)

$TaskName     = "WolfpackParser"
$ShortcutName = "Parser.lnk"

# Config and agent live next to this script file.
# After first-run install, $PSScriptRoot == the EQ directory.
$ConfigFile = Join-Path $PSScriptRoot "logsync.config.json"

# Agent: check next to this script first (post-install path), then fall back
# to the repo's packages/ subfolder (bootstrap path).
$AgentEntry = @(
    (Join-Path $PSScriptRoot "wolfpack-logsync\index.js"),
    (Join-Path $PSScriptRoot "packages\wolfpack-logsync\index.js")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# Detect interactive console: check -NonInteractive flag, not stdin redirect.
# stdin is redirected even when launched from a double-clicked bat file.
$IsInteractive = [Environment]::UserInteractive -and (([Environment]::GetCommandLineArgs() -join ' ') -notlike '*-NonInteractive*')

# ── Common EQ install locations ───────────────────────────────────────────────
# Scans every available drive root for these subfolder names.
# Confirms a match by requiring either log files or eqgame.exe.
$CommonSubPaths = @(
    "EverQuest"
    "EQ"
    "TAKP"
    "TAKP2.2"
    "Games\EverQuest"
    "Games\EQ"
    "Games\TAKP"
    "Program Files (x86)\Sony\EverQuest"
    "Program Files\Sony\EverQuest"
    "Program Files (x86)\Daybreak Game Company\Installed Games\EverQuest"
)

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Header {
    Write-Host ""
    Write-Host "  Wolf Pack EQ -- Parser (wolfpack-logsync)" -ForegroundColor Cyan
    Write-Host "  --------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Find-EqDir {
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
              Where-Object { $_.Root -and (Test-Path $_.Root) }
    foreach ($drive in $drives) {
        foreach ($sub in $CommonSubPaths) {
            $candidate = Join-Path $drive.Root $sub
            if (Test-Path $candidate) {
                $hasLogs = (Get-ChildItem $candidate -Filter "eqlog_*_pq.proj.txt" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
                $hasExe  = Test-Path (Join-Path $candidate "eqgame.exe")
                if ($hasLogs -or $hasExe) { return $candidate }
            }
        }
    }
    return $null
}

function Get-ActiveLogs([string]$dir, [int]$days) {
    $cutoff = (Get-Date).AddDays(-$days)
    Get-ChildItem -Path $dir -Filter "eqlog_*_pq.proj.txt" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $cutoff } |
        Sort-Object LastWriteTime -Descending
}

function Get-AllLogs([string]$dir) {
    Get-ChildItem -Path $dir -Filter "eqlog_*_pq.proj.txt" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
}

# ── Install files into EQ directory ──────────────────────────────────────────
# Called once on first run. Copies this script, Parser.bat, and the agent
# into the EQ directory so everything runs from a Defender-excluded path.
function Install-ToEqDir([string]$eqDir) {
    $agentDest  = Join-Path $eqDir "wolfpack-logsync"
    $scriptDest = Join-Path $eqDir "start-logsync.ps1"
    $batDest    = Join-Path $eqDir "Parser.bat"

    # Create wolfpack-logsync subfolder
    if (-not (Test-Path $agentDest)) {
        New-Item -ItemType Directory -Path $agentDest | Out-Null
    }

    # Copy agent index.js
    if ($AgentEntry -and (Test-Path $AgentEntry)) {
        Copy-Item $AgentEntry (Join-Path $agentDest "index.js") -Force
    } else {
        Write-Host "  WARNING: wolfpack-logsync\index.js not found — skipping agent copy." -ForegroundColor Yellow
        Write-Host "           The repo's packages\wolfpack-logsync\index.js must be present." -ForegroundColor Yellow
    }

    # Copy this script
    $thisScript = $MyInvocation.ScriptName
    if ($thisScript -and (Test-Path $thisScript)) {
        Copy-Item $thisScript $scriptDest -Force
    }

    # Write Parser.bat into EQ dir
    Set-Content $batDest "@echo off
:: Parser.bat -- Wolf Pack EQ log streamer
:: Double-click to start. No setup required after first run.
powershell.exe -NoExit -ExecutionPolicy Bypass -File ""%~dp0start-logsync.ps1""
"

    Write-Host "  Installed Parser to: $eqDir" -ForegroundColor DarkGray
    Write-Host "  (Running from Defender-excluded path)" -ForegroundColor DarkGray
}

# ── Startup wizard helpers ────────────────────────────────────────────────────
function Install-AsService([string]$eqDir) {
    $eqScript = Join-Path $eqDir "start-logsync.ps1"
    $psArgs   = "-WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File `"$eqScript`""
    $action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
    $trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet `
        -Hidden `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit 0 `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Description "Wolf Pack EQ -- streams EQ combat log data to the raid bot" `
        -Force | Out-Null

    Write-Host ""
    Write-Host "  OK  Parser will start automatically when you log into Windows." -ForegroundColor Green
    Write-Host "      It runs silently in the background -- no window to manage." -ForegroundColor DarkGray
    Write-Host "      To stop it:    Open Task Scheduler, find 'WolfpackParser', End Task." -ForegroundColor DarkGray
    Write-Host "      To remove it:  run .\start-logsync.ps1 -Remove  (from EQ folder)" -ForegroundColor DarkGray
    Write-Host "      To change it:  run .\start-logsync.ps1 -Setup   (from EQ folder)" -ForegroundColor DarkGray
}

function Install-Shortcut([string]$folder, [string]$locationLabel, [string]$eqDir) {
    $batPath  = Join-Path $eqDir "Parser.bat"
    $linkPath = Join-Path $folder $ShortcutName
    $shell    = New-Object -ComObject WScript.Shell
    $lnk      = $shell.CreateShortcut($linkPath)
    $lnk.TargetPath       = $batPath
    $lnk.WorkingDirectory = $eqDir
    $lnk.Description      = "Wolf Pack EQ -- wolfpack-logsync"
    $eqExe                = Join-Path $eqDir "eqgame.exe"
    $lnk.IconLocation     = if (Test-Path $eqExe) { "$eqExe,0" } else { "cmd.exe,0" }
    $lnk.Save()

    Write-Host ""
    Write-Host "  OK  'Parser' shortcut added to your $locationLabel." -ForegroundColor Green
    Write-Host "      Double-click it anytime to start Parser." -ForegroundColor DarkGray
    Write-Host "      To remove: run .\start-logsync.ps1 -Remove  (from EQ folder)" -ForegroundColor DarkGray
}

function Show-StartupWizard([string]$eqDir) {
    $hasTask    = $null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    $hasDesktop = Test-Path (Join-Path ([Environment]::GetFolderPath("Desktop")) $ShortcutName)
    $hasMenu    = Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) $ShortcutName)

    if ($hasTask -or $hasDesktop -or $hasMenu) {
        Write-Host "  Current setup:" -ForegroundColor White
        if ($hasTask)    { Write-Host "    * Scheduled task (auto-start)" -ForegroundColor Green }
        if ($hasDesktop) { Write-Host "    * Desktop shortcut"            -ForegroundColor Green }
        if ($hasMenu)    { Write-Host "    * Start menu shortcut"         -ForegroundColor Green }
        Write-Host ""
        Write-Host "  Choose a new option to replace the current setup," -ForegroundColor DarkGray
        Write-Host "  or run .\start-logsync.ps1 -Remove to uninstall everything." -ForegroundColor DarkGray
        Write-Host ""
    }

    Write-Host "  How would you like Parser to start?" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1]  Run automatically  -- starts silently when you log into Windows" -ForegroundColor Cyan
    Write-Host "  [2]  Desktop shortcut   -- adds 'Parser' to your desktop to double-click" -ForegroundColor Cyan
    Write-Host "  [3]  Start menu         -- adds 'Parser' under Start > All Apps" -ForegroundColor Cyan
    Write-Host "  [4]  Skip               -- I'll double-click Parser.bat manually each time" -ForegroundColor DarkGray
    Write-Host ""

    $choice = (Read-Host "  Choice [1-4]").Trim()
    switch ($choice) {
        "1" { Install-AsService $eqDir }
        "2" { Install-Shortcut ([Environment]::GetFolderPath("Desktop"))  "desktop"    $eqDir }
        "3" { Install-Shortcut ([Environment]::GetFolderPath("Programs")) "Start menu" $eqDir }
        "4" { Write-Host "  Skipped. Double-click Parser.bat in your EQ folder anytime." -ForegroundColor DarkGray }
        default { Write-Host "  No valid choice -- skipped." -ForegroundColor DarkGray }
    }
}

# ── -Remove: uninstall task and shortcuts ─────────────────────────────────────
if ($Remove) {
    Write-Header
    $removed = 0

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "  Removed scheduled task '$TaskName'." -ForegroundColor Green
        $removed++
    }

    $desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) $ShortcutName
    if (Test-Path $desktopLnk) {
        Remove-Item $desktopLnk -Force
        Write-Host "  Removed desktop shortcut." -ForegroundColor Green
        $removed++
    }

    $menuLnk = Join-Path ([Environment]::GetFolderPath("Programs")) $ShortcutName
    if (Test-Path $menuLnk) {
        Remove-Item $menuLnk -Force
        Write-Host "  Removed Start menu shortcut." -ForegroundColor Green
        $removed++
    }

    if ($removed -eq 0) { Write-Host "  Nothing to remove." -ForegroundColor DarkGray }
    Write-Host ""
    exit 0
}

# ── Load or build config ──────────────────────────────────────────────────────
Write-Header

if (-not $IsInteractive) {
    if (-not (Test-Path $ConfigFile)) {
        Write-Host "  ERROR: logsync.config.json not found. Run Parser.bat interactively first." -ForegroundColor Red
        exit 1
    }
}

$cfg        = @{ EqDir = ""; BotUrl = ""; Token = "" }
$isFirstRun = $false

if ((Test-Path $ConfigFile) -and -not $Reset) {
    try {
        $saved      = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $cfg.EqDir  = $saved.EqDir
        $cfg.BotUrl = $saved.BotUrl
        $cfg.Token  = $saved.Token
    } catch {
        Write-Host "  Could not read logsync.config.json -- re-prompting." -ForegroundColor Yellow
        $isFirstRun = $true
        $cfg        = @{ EqDir = ""; BotUrl = ""; Token = "" }
    }
} else {
    $isFirstRun = $true
}

# ── EQ directory ──────────────────────────────────────────────────────────────
if ($EqDir -ne "") { $cfg.EqDir = $EqDir }

if (-not $cfg.EqDir -or -not (Test-Path $cfg.EqDir)) {
    $detected = Find-EqDir
    if ($detected) {
        Write-Host "  Found EQ at: $detected" -ForegroundColor Green
        $ans = Read-Host "  Use this path? [Y/n]"
        if ($ans -match "^[Nn]") { $detected = $null }
    }
    if (-not $detected) {
        Write-Host ""
        Write-Host "  Enter the full path to your EverQuest folder." -ForegroundColor White
        Write-Host "  (The folder containing your eqlog_*.txt files.)" -ForegroundColor DarkGray
        $detected = Read-Host "  EQ directory"
    }
    $cfg.EqDir = $detected.Trim('"').Trim()
}

if (-not (Test-Path $cfg.EqDir)) {
    Write-Host ""
    Write-Host "  ERROR: Directory not found: $($cfg.EqDir)" -ForegroundColor Red
    if ($IsInteractive) { Read-Host "  Press Enter to close" }
    exit 1
}

# ── Install files into EQ directory (first run only) ──────────────────────────
# Skip if we're already running from the EQ directory.
$alreadyInEqDir = ($PSScriptRoot -ieq $cfg.EqDir)
if ($isFirstRun -and -not $alreadyInEqDir) {
    Write-Host ""
    Install-ToEqDir $cfg.EqDir

    # Switch config file to EQ dir so it's saved there
    $ConfigFile = Join-Path $cfg.EqDir "logsync.config.json"

    # Also update the agent path to the newly installed copy
    $AgentEntry = Join-Path $cfg.EqDir "wolfpack-logsync\index.js"
}

# ── Bot URL ───────────────────────────────────────────────────────────────────
$DefaultBotUrl = "https://wolfpackparse.up.railway.app/api/agent/encounter"
if (-not $cfg.BotUrl) {
    Write-Host ""
    Write-Host "  Bot upload URL" -ForegroundColor White
    Write-Host "  Default: $DefaultBotUrl" -ForegroundColor DarkGray
    $entered = (Read-Host "  Bot URL (press Enter to use default)").Trim()
    $cfg.BotUrl = if ($entered) { $entered } else { $DefaultBotUrl }
}

# ── Token ─────────────────────────────────────────────────────────────────────
if (-not $cfg.Token) {
    Write-Host ""
    Write-Host "  Agent token (password)" -ForegroundColor White
    Write-Host "  Run /token in Discord to get the current value." -ForegroundColor DarkGray
    $cfg.Token = (Read-Host "  Token").Trim()
}

# ── Save config into EQ directory ─────────────────────────────────────────────
$cfg | ConvertTo-Json | Set-Content $ConfigFile
if ($isFirstRun) {
    Write-Host ""
    Write-Host "  Config saved to: $ConfigFile" -ForegroundColor DarkGray
}

# ── Startup wizard (first run or -Setup) ──────────────────────────────────────
if (($isFirstRun -or $Setup) -and $IsInteractive) {
    Write-Host ""
    Write-Host "  ── Startup preference ───────────────────────────────────────" -ForegroundColor DarkGray
    Show-StartupWizard $cfg.EqDir
    Write-Host ""
}

# ── Find log files ────────────────────────────────────────────────────────────
$activeLogs = Get-ActiveLogs $cfg.EqDir $StaleAfterDays
$allLogs    = Get-AllLogs    $cfg.EqDir

if ($allLogs.Count -eq 0) {
    Write-Host "  ERROR: No eqlog_*_pq.proj.txt files found in:" -ForegroundColor Red
    Write-Host "         $($cfg.EqDir)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Make sure EQ logging is enabled: /log on" -ForegroundColor Yellow
    Write-Host ""
    if ($IsInteractive) { Read-Host "  Press Enter to close" }
    exit 1
}

if ($activeLogs.Count -eq 0) {
    if (-not $IsInteractive) { exit 0 }
    Write-Host "  No log files modified in the last $StaleAfterDays days." -ForegroundColor Yellow
    Write-Host "  Showing all $($allLogs.Count) log file(s) found:" -ForegroundColor White
    Write-Host ""
    foreach ($f in $allLogs) {
        $age = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalDays, 0)
        Write-Host ("  {0,-45} last updated {1} days ago" -f $f.Name, $age) -ForegroundColor Gray
    }
    Write-Host ""
    $ans = Read-Host "  Watch all of them anyway? [y/N]"
    if ($ans -notmatch "^[Yy]") { Write-Host "  Cancelled." -ForegroundColor DarkGray; exit 0 }
    $activeLogs = $allLogs
}

# ── Report what we're watching ────────────────────────────────────────────────
Write-Host "  Watching $($activeLogs.Count) log file(s):" -ForegroundColor White
Write-Host ""
foreach ($f in $activeLogs) {
    $age  = ((Get-Date) - $f.LastWriteTime)
    $when = if     ($age.TotalMinutes -lt 60) { "$([math]::Round($age.TotalMinutes))m ago" }
            elseif ($age.TotalHours   -lt 24) { "$([math]::Round($age.TotalHours))h ago" }
            else                              { "$([math]::Round($age.TotalDays))d ago" }
    $char = if ($f.Name -match "eqlog_(.+)_pq\.proj\.txt") { $Matches[1] } else { $f.Name }
    $hot  = $age.TotalMinutes -lt 60
    Write-Host ("  {0}{1,-22} {2}" -f $(if ($hot) { " *" } else { "  " }), $char, $when) `
        -ForegroundColor $(if ($hot) { "Green" } else { "Gray" })
}

Write-Host ""
if (-not $DryRun) {
    Write-Host "  Uploading to: $($cfg.BotUrl)" -ForegroundColor DarkGray
}
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# ── Verify agent is present ───────────────────────────────────────────────────
if (-not $AgentEntry -or -not (Test-Path $AgentEntry)) {
    Write-Host "  ERROR: Agent not found at expected path." -ForegroundColor Red
    Write-Host "         Run Parser.bat from the repo folder once to reinstall." -ForegroundColor Red
    if ($IsInteractive) { Read-Host "  Press Enter to close" }
    exit 1
}

# ── Build and run node command ────────────────────────────────────────────────
$nodeArgs = @($AgentEntry)
foreach ($f in $activeLogs) {
    $nodeArgs += "--log"
    $nodeArgs += $f.FullName
}
$nodeArgs += "--watch"
$nodeArgs += "--bot-url"
$nodeArgs += $cfg.BotUrl
$nodeArgs += "--token"
$nodeArgs += $cfg.Token
if ($DryRun) { $nodeArgs += "--dry-run" }

& node @nodeArgs
