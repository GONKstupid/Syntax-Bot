# Third-Party-Notizen

Syntax Bot selbst steht unter der [MIT-Lizenz](LICENSE). Es baut auf
Open-Source-Komponenten auf, die mitverteilt werden und unter ihren jeweiligen
Lizenzen bleiben.

Die VS-Code-Extension (VSIX) bündelt die Pi-Laufzeit samt ihrer transitiven
Abhängigkeiten (per esbuild in `dist/extension.js` inlined) und legt
`@silvia-odwyer/photon-node` als Datei unter
`dist/node_modules/@silvia-odwyer/photon-node/` daneben – inklusive der
LICENSE-Datei des Pakets.

## Gebündelte Hauptkomponenten

| Komponente | Version | Lizenz |
|---|---|---|
| `@earendil-works/pi-ai` | 0.84.4 | MIT |
| `@earendil-works/pi-coding-agent` | 0.84.4 | MIT |
| `typebox` | 1.3.7 | MIT |
| `ws` | 8.21.0 | MIT |
| `@silvia-odwyer/photon-node` | 0.3.4 | Apache-2.0 |

- **Pi** (`@earendil-works/pi-*`, MIT) — die Agent-Laufzeit, auf der Syntax Bot
  aufsetzt. Projekt: <https://github.com/earendil-works/pi>
- **typebox** (MIT) — Laufzeit-Schemata der Pi-Extensions.
- **ws** (MIT) — WebSocket-Transport (Web-/ACP-Betriebsart).
- **photon-node** (Apache-2.0) — Bildverarbeitung (WASM), von Pi genutzt.

## Gebündelte Schriften (SIL OFL 1.1)

Web-UI und VS-Code-Extension liefern folgende Schriften als `.woff2` mit aus
(`vscode/web/ui/fonts/`, `vscode/media/fonts/`); die GitHub-Pages-Seite
(`docs/index.html`) lädt dieselben Schriften per Google-Fonts-CDN (keine
Mitverteilung dort). Alle drei stehen unter der SIL Open Font License 1.1
(frei nutzbar, auch kommerziell; kein Verkauf der Font-Dateien allein):

| Schrift | Autor | Lizenz | Upstream |
|---|---|---|---|
| **Doto** (Display) | Ryoichi Tsunekawa | SIL OFL 1.1 | <https://fonts.google.com/specimen/Doto> |
| **JetBrains Mono** (Body/Code) | JetBrains | SIL OFL 1.1 | <https://github.com/JetBrains/JetBrainsMono> |
| **OpenDyslexic** (ehem. LRS-Option) | Abbie Gonzalez | SIL OFL 1.1 | <https://github.com/antijingoist/opendyslexic> |

Hinweis: Für JetBrains Mono gilt Apache-2.0 nur für die Build-Skripte des
Upstream-Repos — die Schriftdateien selbst stehen unter OFL 1.1. Herkunft und
Prüfsummen der gebündelten Dateien: `design/STYLE-SOURCE.md`.

## Apache-2.0 (photon-node)

Für Apache-2.0-lizenzierte Komponenten gilt: Der vollständige Lizenztext liegt
dem Paket bei und wird mit der VSIX mitverteilt
(`extension/dist/node_modules/@silvia-odwyer/photon-node/LICENSE.md`). Eine
ggf. mitgelieferte NOTICE-Datei bleibt unberührt.

## Transitive Abhängigkeiten

Die VSIX bündelt zusätzlich die transitiven Abhängigkeiten der oben genannten
Pakete. Der vollständige Satz entspricht dem Laufzeit-Dependency-Baum von
`@earendil-works/pi-coding-agent`; die Lizenztexte liegen den jeweiligen Paketen
bei bzw. sind über npm einsehbar.
