# Herkunft der Design-Assets

Die Designsprache von Syntax Bot ist von Nothing-Produkten **inspiriert**,
übernimmt aber **nichts** aus dem Nothing-Ökosystem: keine Schriften
(`NDot`, `NDots`, `Lite` sind proprietär), keine Assets/Glyphen/Icons und
keine Marken-Elemente. Alle Bausteine hier sind frei lizenziert (erlaubte
Eingangs-Lizenzen: MIT, SIL OFL, Apache-2.0, CC0) — siehe Spec,
„Design & UI-Konzept".

Die kanonischen Farbwerte liegen in [`tokens.json`](tokens.json);
`web/ui/style.css` spiegelt sie als CSS Custom Properties.

## Schriften

| Rolle | Schrift | Lizenz | Zieldatei | Status |
|---|---|---|---|---|
| Display (Wortmarke, Überschriften, Modus-Anzeige) | **Doto** (Ryoichi Tsunekawa, Punktraster-Variable-Font) | SIL OFL 1.1 | `web/ui/fonts/doto-var.woff2` | **noch nicht gebündelt** |
| Body, Code, Diff | **JetBrains Mono** (JetBrains, Regular + Bold, Ligaturen deaktiviert) | Apache-2.0 | `web/ui/fonts/jetbrains-mono-var.woff2` | **noch nicht gebündelt** |
| Optional: umschaltbare Body-Schrift für LRS | **OpenDyslexic** | Bitstream-Vera-Lizenz (frei) | `web/ui/fonts/opendyslexic-regular.woff2` | geplant (Einstellung folgt) |

**Bezugsquellen:**

* Doto — https://fonts.google.com/specimen/Doto (Variable Font, wght 100–900)
* JetBrains Mono — https://github.com/JetBrains/JetBrainsMono/releases (Apache-2.0)
* OpenDyslexic — https://opendyslexic.org/

**Ablage:** Die `.woff2`-Dateien kommen in `web/ui/fonts/`. Die
`@font-face`-Regeln in `web/ui/style.css` verweisen bereits auf diese Pfade
und fallen solange auf Systemschriften zurück, bis die Dateien liegen.
Beim Bündeln bitte SHA-256 und Version hier ergänzen (analog zur
Cleanup-Stilquelle).

## Icons

Geplant: **Lucide** (ISC) oder **Phosphor** (MIT) als Inline-SVG,
Strichstärke 1,5 px, 24-px-Raster. Aktuell kommt die Web-Oberfläche ohne
Icons aus — Zustände werden über die Punkt-Markierungen (`●○◐`) und
Textlabels kodiert.

## Punktraster-Textur

Das Dot-Raster wird nicht als Grafikdatei mitgeliefert, sondern zur Laufzeit
aus einem `radial-gradient` erzeugt (reduzierte Deckkraft) — kein Asset,
keine Lizenzfrage.
