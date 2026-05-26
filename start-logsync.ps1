# start-logsync.ps1 — Watch all recently-active EQ log files and stream encounter
# data to the Wolf Pack bot.
#
# Run from the QuarmBossTracker folder (normal PowerShell — does NOT need admin).
#
# First run: prompts for your EQ directory, bot URL, and token, then saves them
# to logsync.config.json so you never have to enter them again.
#
# Subsequent runs: just double-click (or: powershell -File start-logsync.ps1)

param(
    [string] $EqDir        = "",      # override EQ install path
    [int]    $StaleAfterDays = 30,    # ignore log files not touched in this many days
    [switch] $DryRun,                 # parse locally, do not upload
    [switch] $Reset                   # forget saved config and re-prompt
)

$ConfigFile = Join-Path $PSScriptRoot "logsync.config.json"
$AgentEntry = Join-Path $PSScriptRoot "packages\wolfpack-logsync\index.js"

# ── Common EQ install locations ───────────────────────────────────────────────
$CommonPaths = @(
    "C:\Program Files (x86)\Sony\EverQuest"
    "C:\Program Files\Sony\EverQuest"
    "C:\Program Files (x86)\Daybreak Game Company\Installed Games\EverQuest"
    "C:\EverQuest"
    "C:\EQ"
    "D:\EverQuest"
    "D:\Games\EverQuest"
    "C:\Games\EverQuest"
)

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Header {
    Write-Host ""
    Write-Host "  Wolf Pack EQ -- wolfpack-logsync" -ForegroundColor Cyan
    Write-Host "  ----------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Find-EqDir {
    foreach ($p in $CommonPaths) {
        if (Test-Path $p) { return $p }
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

# ── Load or build config ──────────────────────────────────────────────────────
Write-Header

$cfg = @{ EqDir = ""; BotUrl = ""; Token = "" }

if ((Test-Path $ConfigFile) -and -not $Reset) {
    try {
        $saved = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $cfg.EqDir  = $saved.EqDir
        $cfg.BotUrl = $saved.BotUrl
        $cfg.Token  = $saved.Token
    } catch {
        Write-Host "  Could not read logsync.config.json -- re-prompting." -ForegroundColor Yellow
        $cfg = @{ EqDir = ""; BotUrl = ""; Token = "" }
    }
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
        Write-Host "  (This is the folder containing eqlog_*.txt files)" -ForegroundColor DarkGray
        $detected = Read-Host "  EQ directory"
    }
    $cfg.EqDir = $detected.Trim('"').Trim()
}

if (-not (Test-Path $cfg.EqDir)) {
    Write-Host ""
    Write-Host "  ERROR: Directory not found: $($cfg.EqDir)" -ForegroundColor Red
    Write-Host "  Check the path and try again." -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

# ── Bot URL ───────────────────────────────────────────────────────────────────
if (-not $cfg.BotUrl) {
    Write-Host ""
    Write-Host "  Bot upload URL (from your Railway deployment, or ask an officer)." -ForegroundColor White
    Write-Host "  Example: https://quarm-bot.up.railway.app/api/agent/encounter" -ForegroundColor DarkGray
    $cfg.BotUrl = (Read-Host "  Bot URL").Trim()
}

# ── Token ─────────────────────────────────────────────────────────────────────
if (-not $cfg.Token) {
    Write-Host ""
    Write-Host "  Agent token (WOLFPACK_AGENT_TOKEN from bot env, or ask an officer)." -ForegroundColor White
    $cfg.Token = (Read-Host "  Token").Trim()
}

# ── Save config ───────────────────────────────────────────────────────────────
$cfg | ConvertTo-Json | Set-Content $ConfigFile
Write-Host ""
Write-Host "  Config saved to logsync.config.json" -ForegroundColor DarkGray

# ── Find log files ────────────────────────────────────────────────────────────
Write-Host ""
$activeLogs = Get-ActiveLogs $cfg.EqDir $StaleAfterDays
$allLogs    = Get-AllLogs    $cfg.EqDir

if ($allLogs.Count -eq 0) {
    Write-Host "  ERROR: No eqlog_*_pq.proj.txt files found in:" -ForegroundColor Red
    Write-Host "         $($cfg.EqDir)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Make sure EQ logging is enabled: /log on" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

if ($activeLogs.Count -eq 0) {
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
    $when = if ($age.TotalMinutes -lt 60)  { "$([math]::Round($age.TotalMinutes))m ago" }
            elseif ($age.TotalHours -lt 24) { "$([math]::Round($age.TotalHours))h ago" }
            else                            { "$([math]::Round($age.TotalDays))d ago" }
    $char = if ($f.Name -match "eqlog_(.+)_pq\.proj\.txt") { $Matches[1] } else { $f.Name }
    $active = if ($age.TotalMinutes -lt 60) { " *" } else { "  " }
    Write-Host ("  {0}{1,-22} {2}" -f $active, $char, $when) -ForegroundColor $(
        if ($age.TotalMinutes -lt 60) { "Green" } else { "Gray" }
    )
}

Write-Host ""
if (-not $DryRun) {
    Write-Host "  Uploading to: $($cfg.BotUrl)" -ForegroundColor DarkGray
}
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# ── Build node command ────────────────────────────────────────────────────────
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

# ── Launch ────────────────────────────────────────────────────────────────────
& node @nodeArgs
