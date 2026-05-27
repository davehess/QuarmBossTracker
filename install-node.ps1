# install-node.ps1 — Check for Node.js 20+ and install if missing
# Run via RUN-FIRST-for-Node.js.bat (handles UAC elevation automatically).
# Direct invocation only needed for Mac/Linux or non-standard setups.

$minVersion  = [Version]"20.0.0"
# MSI fallback version — must be a release that's actually on nodejs.org/dist.
# Don't pin this in the winget call; the winget catalog moves forward and exact
# point-release matches break ("No version found matching: 20.19.1") when newer
# patches supersede this one. winget always gets the current LTS instead.
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
$winget    = Get-Command winget -ErrorAction SilentlyContinue
$wingetOk  = $false

if ($winget) {
    Write-Host "  Installing Node.js LTS via winget..." -ForegroundColor DarkGray
    # --source winget forces the official winget repo (skips the msstore
    #   agreement prompt that confuses some users).
    # NOTE: no --version pin — exact-version installs frequently fail when
    #   the catalog moves on. winget will fetch whatever LTS is current.
    & winget install `
        --id OpenJS.NodeJS.LTS `
        --source winget `
        --silent `
        --accept-package-agreements `
        --accept-source-agreements
    if ($LASTEXITCODE -eq 0) {
        $wingetOk = $true
    } else {
        Write-Host "  winget install returned exit $LASTEXITCODE -- falling back to direct MSI download." -ForegroundColor Yellow
    }
}

if (-not $wingetOk) {
    # ── Fall back to direct MSI download from nodejs.org ─────────────────────
    Write-Host "  Downloading Node.js MSI from nodejs.org..." -ForegroundColor DarkGray
    Write-Host "  URL: $nodeUrl" -ForegroundColor DarkGray
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing -ErrorAction Stop
        Write-Host "  Running silent installer..." -ForegroundColor DarkGray
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait -PassThru
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        if ($proc.ExitCode -ne 0) {
            Write-Host "  msiexec returned exit code $($proc.ExitCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Direct download failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Please download Node.js 20+ manually from https://nodejs.org and re-run Parser.bat." -ForegroundColor Red
    }
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
    Write-Host "  ERROR: Automatic installation failed." -ForegroundColor Red
    Write-Host "  Opening the Node.js download page in your browser..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Steps:" -ForegroundColor White
    Write-Host "    1. Download the 'Windows Installer (.msi)' for the LTS version" -ForegroundColor White
    Write-Host "    2. Run the installer (accept all defaults)" -ForegroundColor White
    Write-Host "    3. Close this window and re-run Parser.bat" -ForegroundColor White
    Write-Host ""
    try { Start-Process "https://nodejs.org/en/download" } catch {
        Write-Host "  Could not open browser automatically." -ForegroundColor DarkGray
        Write-Host "  Open this URL manually: https://nodejs.org/en/download" -ForegroundColor DarkGray
    }
}

Write-Host ""
Read-Host "  Press Enter to close"
