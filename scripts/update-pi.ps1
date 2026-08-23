# Prüft und aktualisiert die Pi-Basis der isolierten Syntax-Bot-Instanz.
#
#   .\scripts\update-pi.ps1           prüfen und bei Bedarf aktualisieren
#   .\scripts\update-pi.ps1 --check   nur den Versionsstand anzeigen
#   .\scripts\update-pi.ps1 --force   Neuinstallation erzwingen

$ErrorActionPreference = "Stop"

& node (Join-Path $PSScriptRoot "bootstrap.mjs") @args | Out-Null
exit $LASTEXITCODE
