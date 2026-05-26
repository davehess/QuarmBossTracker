# install-node.ps1 — Check for Node.js 20+ and install if missing
# Run via install-node.bat (handles UAC elevation automatically)

$minVersion  = [Version]"20.0.0"
$nodeVersion = "20.19.1"
$nodeUrl     = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"
$msiPath     = "$env:TEMP\node-v20-x64.msi"

Write-Host ""
Write-Host "  Wolf Pack EQ -- QuarmBossTracker Setup" -ForegroundColor Cyan
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ── Check existing Node.js ────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue

if ($node) {
    $raw     = (& node --version 2>&1).ToString().Trim()
    $current = [Version]($raw.TrimStart('v'))

    if ($current -ge $minVersion) {
        Write-Host "  OK  Node.js $raw is installed -- nothing to do." -ForegroundColor Green
        Write-Host ""
        Write-Host "  Next step: double-click Parser.bat to start the log watcher." -ForegroundColor White
        Write-Host ""
        Read-Host "  Press Enter to close"
        exit 0
    }

    Write-Host "  Node.js $raw found but v20+ is required. Upgrading..." -ForegroundColor Yellow
} else {
    Write-Host "  Node.js not found. Installing Node.js $nodeVersion LTS..." -ForegroundColor Yellow
}

Write-Host ""

# ── Try winget first (Windows 10 / 11 built-in) ───────────────────────────────
$winget = Get-Command winget -ErrorAction SilentlyContinue

if ($winget) {
    Write-Host "  Downloading via winget..." -ForegroundColor DarkGray
    winget install `
        --id OpenJS.NodeJS.LTS `
        --version $nodeVersion `
        --silent `
        --accept-package-agreements `
        --accept-source-agreements
} else {
    # ── Fall back to direct MSI download ─────────────────────────────────────
    Write-Host "  winget not available -- downloading MSI directly..." -ForegroundColor DarkGray
    Write-Host "  URL: $nodeUrl" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
    Write-Host "  Running silent installer..." -ForegroundColor DarkGray
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
}

# ── Refresh PATH so node is visible without restarting ───────────────────────
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path    = "$machinePath;$userPath"

# ── Verify ────────────────────────────────────────────────────────────────────
$verify = & node --version 2>&1

if ($verify -match "^v") {
    Write-Host ""
    Write-Host "  OK  Node.js $verify installed successfully." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next step: double-click Parser.bat to start the log watcher." -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "  ERROR: Installation may have failed." -ForegroundColor Red
    Write-Host "  Restart this terminal and run the script again, or download" -ForegroundColor Red
    Write-Host "  Node.js 20 manually from: https://nodejs.org" -ForegroundColor Red
}

Write-Host ""
Read-Host "  Press Enter to close"
