@echo off
:: RUN-FIRST-for-Node.js.bat — Wolf Pack EQ Parser: Node.js installer
::
:: Run this ONCE before Parser.bat. It installs Node.js 20 (required to
:: run the agent). After it finishes, double-click Parser.bat.
::
:: Double-click to run — UAC will appear so the installer can write to
:: Program Files. Approve it.

:: ── Check for administrator rights ───────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    :: Re-launch this bat file itself with elevation
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: ── Running as administrator — invoke the PowerShell installer ────────────────
powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0install-node.ps1"
