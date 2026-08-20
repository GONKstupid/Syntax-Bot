# Startet Syntax Bot (Windows). Alle Argumente werden an pi durchgereicht.
#
#   .\scripts\syntax-bot.ps1
#   .\scripts\syntax-bot.ps1 --model anthropic/claude-sonnet-5

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$output = & node (Join-Path $PSScriptRoot "bootstrap.mjs")
if ($LASTEXITCODE -ne 0) { throw "bootstrap.mjs ist fehlgeschlagen." }

$values = @{}
foreach ($line in $output) {
    if ($line -match '^(SYNTAX_BOT_[A-Z_]+)=(.*)$') {
        $values[$Matches[1]] = $Matches[2]
    }
}

if (-not $values.ContainsKey("SYNTAX_BOT_CLI")) { throw "Pfad zur pi-CLI nicht ermittelt." }

$env:PI_CODING_AGENT_DIR = $values["SYNTAX_BOT_AGENT_DIR"]
& node $values["SYNTAX_BOT_CLI"] @args
exit $LASTEXITCODE
