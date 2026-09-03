<p align="center">
  <img src="https://raw.githubusercontent.com/GONKstupid/Syntax-Bot/main/design/icon-512.png" alt="Syntax Bot" width="128" height="128">
</p>

# Syntax Bot

Ein Coding-Agent auf Pi-Basis, der Rechtschreib- und Syntaxfehler korrigiert –
**ohne sich in die Logik einzumischen**. Gedacht als Hilfsmittel bei einer
Lese-Rechtschreib-Schwäche (LRS): Beim Programmieren soll der Gedanke zählen,
nicht die Rechtschreibung.

Die Extension bringt **alles mit**: Die Pi-Laufzeit läuft gebündelt im
Extension-Host, die Konfiguration liegt im von VS Code verwalteten Speicher.
Kein Node, kein CLI-Agent, keine weitere Installation nötig. Das Modell kommt
per BYOM (Bring Your Own Model) dazu.

## Die drei Modi

| Modus | Was er darf | Werkzeuge |
|---|---|---|
| **Syntax Fix** | Nur Rechtschreibung und Syntaxfehler | `read`, `grep`, `find`, `ls`, `edit` |
| **Code Fix** | Zusätzlich echte Fehler und Struktur | dazu `write` und `bash` (frei) |
| **Cleanup** | Nur Struktur und Formatierung, **keine** Logikänderung | wie Syntax Fix, `bash` nur für Formatter/Linter |

Der Modus lässt sich im Chat umschalten; `/modus` zeigt den aktiven Modus,
`/modus-aus` beendet ihn und stellt den vollen Werkzeug-Zugriff wieder her.

## Diff-First

Syntax Bot schreibt nie ungefragt in eine Datei. Vor jedem Schreibvorgang
erscheint der Diff als Übernehmen/Verwerfen-Karte direkt über der Eingabe und
muss bestätigt werden. Gerade als LRS-Hilfsmittel ist das der Kern: Es sollen
keine stillschweigend neuen Fehler entstehen.

## Installation

1. In VS Code die **Extensions**-Leiste öffnen, „Syntax Bot" suchen, **Install**.
2. Alternativ per VSIX: Befehlspalette → „Erweiterungen: VSIX installieren…".
3. Das **Syntax-Bot-Symbol** in der Aktivitätsleiste öffnen und loschatten.

## Modell verbinden (BYOM)

Im Chat `/login` eingeben und einen von drei Wegen wählen:

- API-Key (z. B. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`),
- Anmeldung im Browser (Claude Pro/Max & Co.),
- eigener OpenAI-kompatibler Endpunkt (Ollama, LM Studio, llama.cpp).

Modell, Thinking-Stufe und Modus lassen sich über die Fußleiste umschalten.
Über das ⋯-Menü kann der laufende Thread als Markdown exportiert werden.

## Lizenz

MIT — siehe [LICENSE](https://github.com/GONKstupid/Syntax-Bot/blob/main/LICENSE).
Die Extension bündelt Open-Source-Komponenten (u. a. die MIT-lizenzierte
Pi-Laufzeit und `photon-node` unter Apache-2.0). Details in den
[Third-Party-Notizen](https://github.com/GONKstupid/Syntax-Bot/blob/main/THIRD-PARTY-NOTICES.md).
