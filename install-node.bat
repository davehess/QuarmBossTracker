@echo off
:: install-node.bat — Wolf Pack EQ Parser: Node.js installer
:: Right-click → Run as administrator  (or double-click; UAC will appear)

:: ── Check for administrator rights ───────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator access...
    powershell -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c cd /d \"%~dp0\" ^&^& \"%~f0\"' -Verb RunAs"
    exit /b
)

:: ── Running as administrator — invoke the PowerShell installer ────────────────
powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0install-node.ps1"
