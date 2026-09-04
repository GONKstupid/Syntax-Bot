# Herkunft der Design-Assets

Die Designsprache von Syntax Bot ist von Nothing-Produkten **inspiriert**,
übernimmt aber **nichts** aus dem Nothing-Ökosystem: keine Schriften
(`NDot`, `NDots`, `Lite` sind proprietär), keine Assets/Glyphen/Icons und
keine Marken-Elemente. Alle Bausteine hier sind frei lizenziert (erlaubte
Eingangs-Lizenzen: MIT, SIL OFL, Apache-2.0, CC0) — siehe Spec,
„Design & UI-Konzept".

Die kanonischen Farbwerte liegen in [`tokens.json`](tokens.json); die
Web-Oberfläche nutzt die generierte Datei `web/ui/tokens.css`
(`npm run tokens`). Für die CLI liegt die 16-Farben-Zuordnung in
[`tokens.ansi.json`](tokens.ansi.json) — ebenfalls generiert.

## Schriften

Alle drei Schriften sind gebündelt und liegen unter `web/ui/fonts/`.

| Rolle | Schrift | Lizenz | Datei | Version / SHA-256 |
|---|---|---|---|---|
| Display (Wortmarke, Überschriften, Modus-Anzeige) | **Doto** (Óliver Lalan, Punktraster-Variable-Font) | SIL OFL 1.1 | `doto-var.woff2` (+ `OFL-Doto.txt`) | v3, `0e1a8424…a271b` |
| Body, Code, Diff | **JetBrains Mono** (JetBrains, Regular + Bold, Ligaturen deaktiviert) | SIL OFL 1.1 (nur die Build-Skripte des Upstream-Repos stehen unter Apache-2.0) | `JetBrainsMono-Regular.woff2`, `JetBrainsMono-Bold.woff2` | v2.304, `a9cb1cd8…45f2` / `c503cc5e…88a2` |
| Optional: umschaltbare Body-Schrift für LRS | **OpenDyslexic** (Abbie Gonzalez) | SIL OFL 1.1 | `opendyslexic-regular.woff2` | Fontsource 5.3.0, `f007004a…ac1a` |

Hinweis: OpenDyslexic ist heute unter der **SIL OFL 1.1** lizenziert
(ursprünglich Bitstream-Vera-basiert/CC-BY; die aktuelle Fassung im
Fontsource-Paket ist OFL) — damit sogar freier als in der Spec angenommen.

**Bezugsquellen:**

* Doto — https://fonts.google.com/specimen/Doto (Variable Font, wght 100–900)
* JetBrains Mono — https://github.com/JetBrains/JetBrainsMono/releases (v2.304)
* OpenDyslexic — https://github.com/fontsource/font-files (Paket `@fontsource/opendyslexic`, 5.3.0); Upstream: https://github.com/antijingoist/opendyslexic

## Icons

Geplant: **Lucide** (ISC) oder **Phosphor** (MIT) als Inline-SVG,
Strichstärke 1,5 px, 24-px-Raster. Aktuell kommt die Web-Oberfläche ohne
Icons aus — Zustände werden über die Punkt-Markierungen (`●○◐`) und
Textlabels kodiert.

## Punktraster-Textur

Das Dot-Raster wird nicht als Grafikdatei mitgeliefert, sondern zur Laufzeit
aus einem `radial-gradient` erzeugt (reduzierte Deckkraft) — kein Asset,
keine Lizenzfrage.
