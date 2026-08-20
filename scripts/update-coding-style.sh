#!/usr/bin/env bash
# Gleicht die mitgelieferte Cleanup-Stilquelle gegen den Linux-Kernel ab.
#
#   bash scripts/update-coding-style.sh           zeigt nur den Diff
#   bash scripts/update-coding-style.sh --apply   übernimmt die neue Fassung
#
# Ohne --apply wird nichts geschrieben (Diff-First gilt auch für Skripte).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STYLE_FILE="$REPO_ROOT/extensions/cleanup/styles/linux-kernel-coding-style.rst"
SOURCE_DOC="$REPO_ROOT/extensions/cleanup/styles/STYLE-SOURCE.md"
RAW_URL="https://raw.githubusercontent.com/torvalds/linux/master/Documentation/process/coding-style.rst"
API_URL="https://api.github.com/repos/torvalds/linux/commits?path=Documentation/process/coding-style.rst&per_page=1"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
NEW_FILE="$TMP_DIR/coding-style.rst"

echo "Lade $RAW_URL …"
curl -fsSL "$RAW_URL" -o "$NEW_FILE"

if cmp -s "$STYLE_FILE" "$NEW_FILE"; then
    echo "Die Stilquelle ist bereits aktuell."
    exit 0
fi

echo
echo "Unterschiede zur mitgelieferten Fassung:"
diff -u "$STYLE_FILE" "$NEW_FILE" || true
echo

if [ "$APPLY" -eq 0 ]; then
    echo "Nichts geschrieben. Mit --apply übernehmen."
    exit 0
fi

COMMIT="$(curl -fsSL "$API_URL" | grep -m1 '"sha"' | cut -d'"' -f4 || true)"
[ -z "$COMMIT" ] && COMMIT="unbekannt"

cp "$NEW_FILE" "$STYLE_FILE"

NEW_HASH="$(sha256sum "$STYLE_FILE" | cut -d' ' -f1)"
NEW_LINES="$(wc -l < "$STYLE_FILE" | tr -d ' ')"

# Kennzahlen in STYLE-SOURCE.md zurückschreiben, damit die Fassung gepinnt bleibt.
sed -i.bak \
    -e "s#^| Zeilen |.*#| Zeilen | $NEW_LINES |#" \
    -e "s#^| SHA-256 |.*#| SHA-256 | \`$NEW_HASH\` |#" \
    -e "s#^| Upstream-Commit |.*#| Upstream-Commit | \`$COMMIT\` |#" \
    "$SOURCE_DOC"
rm -f "$SOURCE_DOC.bak"

echo "Übernommen."
echo "  Commit:  $COMMIT"
echo "  SHA-256: $NEW_HASH"
echo "  Zeilen:  $NEW_LINES"
