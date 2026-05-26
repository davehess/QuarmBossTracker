# start-logsync.ps1 — Watch all recently-active EQ log files and stream encounter
# data to the Wolf Pack bot.
#
# First run:  prompts for your EQ directory, bot URL, and token, saves them to
#             logsync.config.json, then asks how you'd like Parser to start.
#
# After that: just run it — or it may already be running automatically.
#
# Flags:
#   -Setup           Re-run the startup wizard (change service/shortcut preference)
#   -Remove          Remove the scheduled task and any shortcuts
#   -Reset           Forget all saved settings and start over
#   -DryRun          Parse locally, print encounter summaries — nothing uploaded
#   -StaleAfterDays  How many days back to look for active log files (default 30)
#   -EqDir           Override the EQ directory without re-prompting

param(
    [string] $EqDir           = "",
    [int]    $StaleAfterDays  = 30,
    [switch] $DryRun,
    [switch] $Reset,
    [switch] $Setup,
    [switch] $Remove
)

$TaskName     = "WolfpackParser"
$ShortcutName = "Parser.lnk"
$ConfigFile   = Join-Path $PSScriptRoot "logsync.config.json"
$AgentEntry   = Join-Path $PSScriptRoot "packages\wolfpack-logsync\index.js"
$ScriptPath   = $MyInvocation.MyCommand.Path   # full path to this file

# Detect whether we have an interactive console (false when run as a scheduled task)
$IsInteractive = [Environment]::UserInteractive -and (-not [Console]::IsInputRedirected)

# ── Common EQ install locations ───────────────────────────────────────────────
# Checked in order; first match wins.
# Also scans all available drive roots for EQ / TAKP / TAKP2.2 automatically.
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
    # Enumerate every available drive, check common subfolder names at each root
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
              Where-Object { $_.Root -and (Test-Path $_.Root) }
    foreach ($drive in $drives) {
        foreach ($sub in $CommonSubPaths) {
            $candidate = Join-Path $drive.Root $sub
            if (Test-Path $candidate) {
                # Confirm it looks like an EQ folder (has log files or eqgame.exe)
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

# ── Startup wizard ────────────────────────────────────────────────────────────
function Install-AsService {
    # Register a Task Scheduler task that runs this script at every logon,
    # hidden, with no console window.
    $psArgs   = "-WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""
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
    Write-Host ""
    Write-Host "      To stop it:    Open Task Scheduler, find 'WolfpackParser', End Task." -ForegroundColor DarkGray
    Write-Host "      To remove it:  .\start-logsync.ps1 -Remove" -ForegroundColor DarkGray
    Write-Host "      To change it:  .\start-logsync.ps1 -Setup" -ForegroundColor DarkGray
}

function Install-Shortcut([string]$folder, [string]$locationLabel) {
    $batPath  = Join-Path $PSScriptRoot "Parser.bat"
    $linkPath = Join-Path $folder $ShortcutName
    $shell    = New-Object -ComObject WScript.Shell
    $lnk      = $shell.CreateShortcut($linkPath)

    # Point to Parser.bat — cmd.exe can open it directly, no execution policy needed
    $lnk.TargetPath       = $batPath
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.Description      = "Wolf Pack EQ -- wolfpack-logsync"

    # Use eqgame.exe icon if available; otherwise the EQ folder icon; finally cmd icon
    $eqExe = Join-Path $cfg.EqDir "eqgame.exe"
    $lnk.IconLocation = if (Test-Path $eqExe) { "$eqExe,0" } else { "cmd.exe,0" }
    $lnk.Save()

    Write-Host ""
    Write-Host "  OK  'Parser' shortcut added to your $locationLabel." -ForegroundColor Green
    Write-Host "      Double-click it anytime to start Parser." -ForegroundColor DarkGray
    Write-Host "      To remove: .\start-logsync.ps1 -Remove" -ForegroundColor DarkGray
}

function Show-StartupWizard {
    # Warn if already installed
    $hasTask    = $null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    $hasDesktop = Test-Path (Join-Path ([Environment]::GetFolderPath("Desktop")) $ShortcutName)
    $hasMenu    = Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) $ShortcutName)

    if ($hasTask -or $hasDesktop -or $hasMenu) {
        Write-Host "  Current setup:" -ForegroundColor White
        if ($hasTask)    { Write-Host "    * Scheduled task (auto-start)" -ForegroundColor Green }
        if ($hasDesktop) { Write-Host "    * Desktop shortcut" -ForegroundColor Green }
        if ($hasMenu)    { Write-Host "    * Start menu shortcut" -ForegroundColor Green }
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
    Write-Host "  [4]  Skip               -- I'll run .\start-logsync.ps1 manually each time" -ForegroundColor DarkGray
    Write-Host ""

    $choice = (Read-Host "  Choice [1-4]").Trim()
    switch ($choice) {
        "1" { Install-AsService }
        "2" { Install-Shortcut ([Environment]::GetFolderPath("Desktop")) "desktop" }
        "3" { Install-Shortcut ([Environment]::GetFolderPath("Programs")) "Start menu" }
        "4" { Write-Host "  Skipped. Run .\start-logsync.ps1 anytime to start Parser." -ForegroundColor DarkGray }
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

    if ($removed -eq 0) {
        Write-Host "  Nothing to remove." -ForegroundColor DarkGray
    }
    Write-Host ""
    exit 0
}

# ── Load or build config ──────────────────────────────────────────────────────
Write-Header

# Non-interactive (running as scheduled task): require saved config — never prompt
if (-not $IsInteractive) {
    if (-not (Test-Path $ConfigFile)) {
        Write-Host "  ERROR: logsync.config.json not found. Run start-logsync.ps1 interactively first." -ForegroundColor Red
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
        Write-Host "  (This is the folder that contains your eqlog_*.txt files.)" -ForegroundColor DarkGray
        $detected = Read-Host "  EQ directory"
    }
    $cfg.EqDir = $detected.Trim('"').Trim()
}

if (-not (Test-Path $cfg.EqDir)) {
    Write-Host ""
    Write-Host "  ERROR: Directory not found: $($cfg.EqDir)" -ForegroundColor Red
    Write-Host "  Check the path and try again." -ForegroundColor Red
    Write-Host ""
    if ($IsInteractive) { Read-Host "  Press Enter to close" }
    exit 1
}

# ── Bot URL ───────────────────────────────────────────────────────────────────
if (-not $cfg.BotUrl) {
    Write-Host ""
    Write-Host "  Bot upload URL -- ask an officer for this." -ForegroundColor White
    Write-Host "  Example: https://quarm-bot.up.railway.app/api/agent/encounter" -ForegroundColor DarkGray
    $cfg.BotUrl = (Read-Host "  Bot URL").Trim()
}

# ── Token ─────────────────────────────────────────────────────────────────────
if (-not $cfg.Token) {
    Write-Host ""
    Write-Host "  Agent token -- ask an officer for this." -ForegroundColor White
    $cfg.Token = (Read-Host "  Token").Trim()
}

# ── Save config ───────────────────────────────────────────────────────────────
$cfg | ConvertTo-Json | Set-Content $ConfigFile
if ($isFirstRun) {
    Write-Host ""
    Write-Host "  Config saved to logsync.config.json" -ForegroundColor DarkGray
}

# ── Startup wizard (first run or -Setup) ──────────────────────────────────────
if (($isFirstRun -or $Setup) -and $IsInteractive) {
    Write-Host ""
    Write-Host "  ── Startup preference ───────────────────────────────────────" -ForegroundColor DarkGray
    Show-StartupWizard
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
    if (-not $IsInteractive) { exit 0 }   # nothing to do, exit cleanly as service
    Write-Host "  No log files modified in the last $StaleAfterDays days." -ForegroundColor Yellow
    Write-Host "  Showing all $($allLogs.Count) log file(s) found:" -ForegroundColor White
    Write-Host ""
    foreach ($f in $allLogs) {
        $age = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalDays, 0)
        Write-Host ("  {0,-45} last updated {1} days ago" -f $f.Name, $age) -ForegroundColor Gray
    }
    Write-Host ""
    $ans = Read-Host "  Watch all of them anyway? [y/N]"
    if ($ans -notmatch "^[Yy]") {
        Write-Host "  Cancelled." -ForegroundColor DarkGray
        exit 0
    }
    $activeLogs = $allLogs
}

# ── Report what we're watching ────────────────────────────────────────────────
Write-Host "  Watching $($activeLogs.Count) log file(s):" -ForegroundColor White
Write-Host ""
foreach ($f in $activeLogs) {
    $age  = ((Get-Date) - $f.LastWriteTime)
    $when = if     ($age.TotalMinutes -lt 60)  { "$([math]::Round($age.TotalMinutes))m ago" }
            elseif ($age.TotalHours   -lt 24)  { "$([math]::Round($age.TotalHours))h ago" }
            else                               { "$([math]::Round($age.TotalDays))d ago" }
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
