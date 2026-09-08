@echo off
rem mimic-netdiag.bat — double-click wrapper for mimic-netdiag.ps1 (same folder).
rem Pass options through, e.g.:  mimic-netdiag.bat -Live      or   mimic-netdiag.bat -Watch
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mimic-netdiag.ps1" %*
echo.
pause
