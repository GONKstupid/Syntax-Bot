@echo off
rem Startet Syntax Bot ohne PowerShell-Ausfuehrungsblockade.
rem   syntax-bot.cmd [pi-Argumente]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0syntax-bot.ps1" %*
