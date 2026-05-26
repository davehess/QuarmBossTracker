@echo off
:: install-node.bat — Wolf Pack EQ Parser: Node.js installer
:: Double-click to run — UAC will appear if admin rights are needed

:: ── Check for administrator rights ───────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    :: Re-launch this bat file itself with elevation
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: ── Running as administrator — invoke the PowerShell installer ────────────────
powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0install-node.ps1"
