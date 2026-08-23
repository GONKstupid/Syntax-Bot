#!/usr/bin/env bash
# Prüft und aktualisiert die Pi-Basis der isolierten Syntax-Bot-Instanz.
#
#   bash scripts/update-pi.sh           prüfen und bei Bedarf aktualisieren
#   bash scripts/update-pi.sh --check   nur den Versionsstand anzeigen
#   bash scripts/update-pi.sh --force   Neuinstallation erzwingen

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$REPO_ROOT/scripts/bootstrap.mjs" "$@" > /dev/null
echo "Fertig."
