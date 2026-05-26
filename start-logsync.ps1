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
    [switch] $Remove,
    [switch] $NoUpdate,
    [switch] $ForceUpdate
)

$TaskName     = "WolfpackParser"
$ShortcutName = "Parser.lnk"

# ── Auto-update configuration ─────────────────────────────────────────────────
# We fetch the agent source straight from GitHub's main branch on the official
# repo. If you fork or self-host, change *_RAW_URL to your own raw URL.
$AGENT_RAW_URL              = "https://raw.githubusercontent.com/davehess/QuarmBossTracker/main/packages/wolfpack-logsync/index.js"
$AGENT_PKG_RAW_URL          = "https://raw.githubusercontent.com/davehess/QuarmBossTracker/main/packages/wolfpack-logsync/package.json"
$SCRIPT_RAW_URL             = "https://raw.githubusercontent.com/davehess/QuarmBossTracker/main/start-logsync.ps1"
$AGENT_UPDATE_INTERVAL_HRS  = 12

# Displayed in console output during updates.  The auto-update mechanism does
# NOT depend on this string — it compares full file content (normalized line
# endings) so an update fires whenever the GitHub copy actually differs, even
# if I forgot to bump the version.  The version is informational only.
$SCRIPT_VERSION             = "2.2.4"

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
    # First, check the parent of where this script lives — covers the very common
    # case where users extract WolfPackParser.zip INSIDE their EQ install folder
    # (e.g. C:\Users\X\Downloads\TAKP\WolfPackParser\). The previous version only
    # scanned drive roots for known subpath names and missed nested installs.
    if ($PSScriptRoot) {
        $parent = Split-Path $PSScriptRoot -Parent
        if ($parent -and (Test-Path $parent)) {
            $hasLogs = (Get-ChildItem $parent -Filter "eqlog_*_pq.proj.txt" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
            $hasExe  = Test-Path (Join-Path $parent "eqgame.exe")
            if ($hasLogs -or $hasExe) { return $parent }
        }
    }

    # Then scan drive roots for the well-known install location names.
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
    if ([string]::IsNullOrWhiteSpace($eqDir) -or -not (Test-Path $eqDir)) {
        Write-Host "  ERROR: Cannot install scheduled task — EQ directory is not set or doesn't exist." -ForegroundColor Red
        Write-Host "         Re-run Parser.bat -Reset to enter your EQ folder again." -ForegroundColor DarkGray
        return
    }
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
    if ([string]::IsNullOrWhiteSpace($eqDir) -or -not (Test-Path $eqDir)) {
        Write-Host "  ERROR: Cannot install shortcut — EQ directory is not set or doesn't exist." -ForegroundColor Red
        Write-Host "         Re-run Parser.bat -Reset to enter your EQ folder again." -ForegroundColor DarkGray
        return
    }
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

# ── Auto-update the agent from GitHub ────────────────────────────────────────
# Fetches the raw index.js, compares its AGENT_VERSION against the local copy.
# On mismatch: downloads to <agent>.tmp, validates it parses by looking for the
# version string, then atomic-renames over the live file.
#
# Throttled to once every $AGENT_UPDATE_INTERVAL_HRS hours via a marker file in
# the agent folder. -ForceUpdate bypasses the throttle. -NoUpdate skips entirely.
#
# Returns $true if the file was updated (caller should re-launch node).
function Update-Agent([string]$agentPath, [bool]$silent) {
    if ($NoUpdate)                    { return $false }
    if (-not (Test-Path $agentPath))  { return $false }
    if ($cfg.AutoUpdate -eq $false)   { return $false }   # opt-out via config

    $agentDir   = Split-Path $agentPath -Parent
    $pkgPath    = Join-Path $agentDir "package.json"
    $markerFile = Join-Path $agentDir ".last-update-check"

    if (-not $ForceUpdate -and (Test-Path $markerFile)) {
        $age = (Get-Date) - (Get-Item $markerFile).LastWriteTime
        if ($age.TotalHours -lt $AGENT_UPDATE_INTERVAL_HRS) { return $false }
    }

    try {
        # Pull remote agent source + companion package.json (which carries the
        # version string the agent displays).  We update BOTH atomically so the
        # dashboard's displayed version always reflects the running code.
        $resp     = Invoke-WebRequest -Uri $AGENT_RAW_URL     -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $respPkg  = Invoke-WebRequest -Uri $AGENT_PKG_RAW_URL -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $remote     = $resp.Content
        $remotePkg  = $respPkg.Content
        if (-not $remote) { return $false }

        # Normalize line endings before comparison: GitHub raw serves LF, but
        # locally extracted ZIPs on Windows may be CRLF (depends on archiver).
        # Without this, every launch would falsely detect a "change".
        # (Avoid ?? null-coalescing — that's PS7+ only; many installs are PS5.)
        $remoteNorm    = ([string]$remote)    -replace "`r`n", "`n"
        $remotePkgNorm = ([string]$remotePkg) -replace "`r`n", "`n"
        $localText     = if (Test-Path $agentPath) { Get-Content $agentPath -Raw } else { "" }
        $localNorm     = ([string]$localText)  -replace "`r`n", "`n"
        $localPkgText  = if (Test-Path $pkgPath) { Get-Content $pkgPath -Raw } else { "" }
        $localPkgNorm  = ([string]$localPkgText) -replace "`r`n", "`n"

        # Mark this check as done so we don't hammer GitHub
        Set-Content $markerFile (Get-Date).ToString("o")

        $indexChanged = ($remoteNorm -ne $localNorm)
        $pkgChanged   = ($remotePkg -and ($remotePkgNorm -ne $localPkgNorm))

        if (-not $indexChanged -and -not $pkgChanged -and -not $ForceUpdate) {
            return $false
        }

        # Pull version strings for the display message (auto-update no longer
        # *depends* on them — content comparison is authoritative — but they're
        # useful in the changelog line).
        $remoteVer = ([regex]::Match(([string]$remotePkg), '"version"\s*:\s*"([^"]+)"')).Groups[1].Value
        if (-not $remoteVer) { $remoteVer = ([regex]::Match($remote, "AGENT_VERSION\s*=\s*['""]([^'""]+)['""]")).Groups[1].Value }
        $localVer  = ([regex]::Match($localPkgNorm, '"version"\s*:\s*"([^"]+)"')).Groups[1].Value
        if (-not $localVer)  { $localVer  = ([regex]::Match($localNorm,  "AGENT_VERSION\s*=\s*['""]([^'""]+)['""]")).Groups[1].Value }

        if (-not $silent) {
            Write-Host ""
            $verStr = if ($remoteVer -and $localVer -and $remoteVer -ne $localVer) { "$localVer -> $remoteVer" } else { "content changed" }
            Write-Host "  Update available: agent ($verStr)" -ForegroundColor Yellow
        }

        # Atomic write of index.js: temp -> rename
        $tmp = "$agentPath.tmp"
        Set-Content -LiteralPath $tmp -Value $remote -NoNewline

        # Sanity check: must contain AGENT_VERSION and EncounterBuilder so we
        # don't atomically rename garbage on top of a working file.
        $tmpContent = Get-Content $tmp -Raw
        if (($tmpContent -notmatch "AGENT_VERSION") -or ($tmpContent -notmatch "EncounterBuilder")) {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            if (-not $silent) { Write-Host "  Update failed: downloaded file looks corrupt; keeping current version." -ForegroundColor Red }
            return $false
        }

        Move-Item -LiteralPath $tmp -Destination $agentPath -Force

        # Also update package.json so the agent reads the new version string.
        if ($pkgChanged -and $remotePkg) {
            $tmpPkg = "$pkgPath.tmp"
            Set-Content -LiteralPath $tmpPkg -Value $remotePkg -NoNewline
            if ((Get-Content $tmpPkg -Raw) -match '"version"') {
                Move-Item -LiteralPath $tmpPkg -Destination $pkgPath -Force
            } else {
                Remove-Item $tmpPkg -Force -ErrorAction SilentlyContinue
            }
        }

        if (-not $silent) {
            Write-Host "  Updated$(if ($remoteVer) { ' to ' + $remoteVer } else { '' })." -ForegroundColor Green
        }
        return $true
    } catch {
        if (-not $silent) {
            Write-Host "  Update check skipped: $($_.Exception.Message)" -ForegroundColor DarkGray
        }
        return $false
    }
}

# ── Auto-update start-logsync.ps1 itself ─────────────────────────────────────
# Fetches the raw .ps1 from GitHub, compares the embedded $SCRIPT_VERSION
# constant. If newer, atomically rewrites THIS file. The replacement takes
# effect on the NEXT launch — we don't try to re-exec ourselves mid-run
# because that's a fragile pattern on Windows scheduled tasks and PSCommandPath
# can be empty in some launch contexts.
#
# Without this function, agent code (index.js) can self-update but the
# surrounding script can't — leading to version mismatches like a marker
# the agent writes that the old script doesn't know how to act on.
function Update-Script([bool]$silent) {
    if ($NoUpdate)                     { return $false }
    if ($cfg.AutoUpdate -eq $false)    { return $false }
    if (-not $PSCommandPath)           { return $false }   # script run via -Command, can't self-update
    if (-not (Test-Path $PSCommandPath)) { return $false }

    try {
        $resp   = Invoke-WebRequest -Uri $SCRIPT_RAW_URL -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $remote = $resp.Content
        if (-not $remote) { return $false }

        # Content comparison (normalized line endings) — version string is
        # informational only, content is authoritative.
        $remoteNorm = ([string]$remote) -replace "`r`n", "`n"
        $localText  = if (Test-Path $PSCommandPath) { Get-Content $PSCommandPath -Raw } else { "" }
        $localNorm  = ([string]$localText) -replace "`r`n", "`n"
        if ($remoteNorm -eq $localNorm) { return $false }

        $remoteVer = ([regex]::Match($remote, '\$SCRIPT_VERSION\s*=\s*[''"]([^''"]+)[''"]')).Groups[1].Value
        $localVer  = $SCRIPT_VERSION

        if (-not $silent) {
            Write-Host ""
            $verStr = if ($remoteVer -and $remoteVer -ne $localVer) { "$localVer -> $remoteVer" } else { "content changed" }
            Write-Host "  start-logsync.ps1 update available ($verStr)" -ForegroundColor Yellow
        }

        $tmp = "$PSCommandPath.tmp"
        Set-Content -LiteralPath $tmp -Value $remote -NoNewline

        # Sanity check: must look like our script (contains the version constant
        # and the Update-Agent function) before we atomically swap.
        $tmpContent = Get-Content $tmp -Raw
        if (($tmpContent -notmatch '\$SCRIPT_VERSION') -or ($tmpContent -notmatch 'Update-Agent')) {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            if (-not $silent) { Write-Host "  Script update failed: downloaded file looks corrupt." -ForegroundColor Red }
            return $false
        }

        Move-Item -LiteralPath $tmp -Destination $PSCommandPath -Force
        if (-not $silent) {
            Write-Host "  Script updated$(if ($remoteVer) { ' to ' + $remoteVer } else { '' }). New version takes effect on next launch." -ForegroundColor Green
        }
        return $true
    } catch {
        if (-not $silent) {
            Write-Host "  Script update check skipped: $($_.Exception.Message)" -ForegroundColor DarkGray
        }
        return $false
    }
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

$cfg        = @{ EqDir = ""; BotUrl = ""; Token = ""; AutoUpdate = $true }
$isFirstRun = $false

# Find an existing config file. Two locations are checked, in order:
#   1. Next to this script — the post-install path inside the EQ dir
#   2. Inside the auto-detected EQ folder — covers re-extracting the zip
#      anywhere else (Downloads, Desktop, etc.) without losing saved settings
$existingConfig = $null
if (Test-Path $ConfigFile) {
    $existingConfig = $ConfigFile
} elseif (-not $Reset) {
    $detected = Find-EqDir
    if ($detected) {
        $candidate = Join-Path $detected "logsync.config.json"
        if (Test-Path $candidate) { $existingConfig = $candidate }
    }
}

if ($existingConfig -and -not $Reset) {
    try {
        $saved      = Get-Content $existingConfig -Raw | ConvertFrom-Json
        $cfg.EqDir  = $saved.EqDir
        $cfg.BotUrl = $saved.BotUrl
        $cfg.Token  = $saved.Token
        if ($null -ne $saved.AutoUpdate) { $cfg.AutoUpdate = [bool]$saved.AutoUpdate }
        $ConfigFile = $existingConfig
        if ($existingConfig -ne (Join-Path $PSScriptRoot "logsync.config.json")) {
            Write-Host "  Loaded saved settings: $existingConfig" -ForegroundColor DarkGray
            Write-Host "  (no prompts needed -- run with -Setup to change)" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  Could not read $existingConfig -- re-prompting." -ForegroundColor Yellow
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
    # Re-prompt until we get a non-empty, existent path or the user explicitly
    # aborts. Previously, hitting Enter at the manual prompt silently set
    # $cfg.EqDir to '' and the rest of the flow crashed deep inside Install-AsService.
    $attempts = 0
    while (-not $detected -or [string]::IsNullOrWhiteSpace($detected) -or -not (Test-Path $detected.Trim('"').Trim())) {
        if ($attempts -ge 3) {
            Write-Host ""
            Write-Host "  ERROR: No valid EverQuest folder provided after 3 attempts." -ForegroundColor Red
            Write-Host "         Re-run Parser.bat once you know the path." -ForegroundColor DarkGray
            if ($IsInteractive) { Read-Host "  Press Enter to close" }
            exit 1
        }
        if ($attempts -gt 0 -and $detected) {
            Write-Host "  Path not found: $detected" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  Enter the full path to your EverQuest folder." -ForegroundColor White
        Write-Host "  (The folder containing eqgame.exe and your eqlog_*.txt files.)" -ForegroundColor DarkGray
        $detected = Read-Host "  EQ directory"
        $attempts++
    }
    $cfg.EqDir = $detected.Trim('"').Trim()
}

# Belt-and-braces: even after the loop, make absolutely sure $cfg.EqDir is
# usable before we hand it to Install-ToEqDir / the scheduled-task wizard.
if ([string]::IsNullOrWhiteSpace($cfg.EqDir) -or -not (Test-Path $cfg.EqDir)) {
    Write-Host ""
    Write-Host "  ERROR: Directory not found: '$($cfg.EqDir)'" -ForegroundColor Red
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
    $shownDir = if ([string]::IsNullOrWhiteSpace($cfg.EqDir)) { '<unset>' } else { $cfg.EqDir }
    Write-Host "  ERROR: No eqlog_*_pq.proj.txt files found in:" -ForegroundColor Red
    Write-Host "         $shownDir" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Make sure EQ logging is enabled in-game: /log on" -ForegroundColor Yellow
    Write-Host "  Also verify the EQ path above is correct -- re-run Parser.bat -Reset to change it." -ForegroundColor Yellow
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

# ── Auto-update the agent (throttled, opt-out via -NoUpdate or config) ───────
# If the agent dropped a .force-update-on-restart marker (user pressed [U] in
# the dashboard), force a check this launch and clean the marker afterwards.
$forceMarker = Join-Path (Split-Path $AgentEntry) ".force-update-on-restart"
$forceThisRun = Test-Path $forceMarker
if ($forceThisRun) {
    Remove-Item $forceMarker -Force -ErrorAction SilentlyContinue
    $ForceUpdate = $true
}

# Silent in scheduled-task mode so the task log stays quiet. The agent's own
# next-launch picks up the new file because we always re-read AgentEntry below.
$updated = Update-Agent -agentPath $AgentEntry -silent:(-not $IsInteractive)
if ($updated -and $IsInteractive) {
    Write-Host "  Re-launching with the new agent..." -ForegroundColor DarkGray
    Write-Host ""
}

# Self-update start-logsync.ps1 itself.  The new copy takes effect on the
# NEXT Parser.bat launch (Windows happily lets us overwrite the running script
# since PowerShell loads it into memory at parse time, but mid-run re-exec is
# fragile so we just rewrite and continue with the in-memory copy).
$scriptUpdated = Update-Script -silent:(-not $IsInteractive)
if ($scriptUpdated -and $IsInteractive) {
    Write-Host "  (Continuing with the in-memory script; new version applies next launch.)" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Build and run node command ────────────────────────────────────────────────
# We loop the node invocation so that pressing [U] in the dashboard (which
# exits node with code 0 after dropping the marker) re-enters this script,
# applies the update, and relaunches automatically.
while ($true) {
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
    $exitCode = $LASTEXITCODE

    # If the agent dropped an update marker, re-run Update-Agent with force and loop.
    if (Test-Path $forceMarker) {
        Remove-Item $forceMarker -Force -ErrorAction SilentlyContinue
        $ForceUpdate = $true
        Update-Agent -agentPath $AgentEntry -silent:$false | Out-Null
        Start-Sleep -Milliseconds 500
        continue
    }

    # If the agent dropped a token-update marker, prompt for a new token,
    # rewrite logsync.config.json, then loop.
    $tokenMarker = Join-Path (Split-Path $AgentEntry) ".update-token-on-restart"
    if (Test-Path $tokenMarker) {
        Remove-Item $tokenMarker -Force -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "  ── New agent token ────────────────────────────────────────" -ForegroundColor Cyan
        Write-Host "  Paste the new value from /token in Discord." -ForegroundColor DarkGray
        Write-Host "  Press Enter alone to keep the current token." -ForegroundColor DarkGray
        $newToken = (Read-Host "  Token").Trim()
        if ($newToken) {
            $cfg.Token = $newToken
            $cfg | ConvertTo-Json | Set-Content $ConfigFile
            Write-Host "  Token updated." -ForegroundColor Green
        } else {
            Write-Host "  Kept existing token." -ForegroundColor DarkGray
        }
        Write-Host ""
        Start-Sleep -Milliseconds 300
        continue
    }
    break
}
