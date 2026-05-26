@echo off
:: Parser.bat — Wolf Pack EQ log streamer
:: Double-click this to start Parser. No setup required — just run it.
:: First time: will ask for your EQ directory and bot token, then save them.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0start-logsync.ps1"
