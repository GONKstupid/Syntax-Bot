#!/usr/bin/env bash
# Startet Syntax Bot (Linux/macOS). Alle Argumente werden an pi durchgereicht.
#
#   bash scripts/syntax-bot.sh
#   bash scripts/syntax-bot.sh --model anthropic/claude-sonnet-5

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BOOTSTRAP_OUTPUT="$(node "$REPO_ROOT/scripts/bootstrap.mjs")"
eval "$BOOTSTRAP_OUTPUT"

export PI_CODING_AGENT_DIR="$SYNTAX_BOT_AGENT_DIR"
exec node "$SYNTAX_BOT_CLI" "$@"
