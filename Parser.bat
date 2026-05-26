@echo off
:: Parser.bat — Wolf Pack EQ log streamer
::
:: First run (from the repo): installs Parser into your EQ directory, where
::   Windows Defender exclusions already apply. Shortcuts and the auto-start
::   task will point to your EQ folder copy from that point on.
::
:: After first run: use the Parser.bat that was copied to your EQ folder,
::   or use whatever shortcut / auto-start you chose during setup.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0start-logsync.ps1"
