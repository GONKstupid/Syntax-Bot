# Syntax Bot — Specification

> Diese Datei ist die Quelle der Wahrheit für Syntax Bot v1. Alles Weitere
> (Extensions, Prompt-Templates, Doku) leitet sich hieraus ab.

---

## Soul

Syntax Bot ist ein Coding-„Agent", der auf dem [Pi Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
basiert. Syntax Bot soll ein hilfreiches Tool sein, um meine LRS
(Lese-Rechtschreib-Schwäche) auszugleichen.

Syntax Bot soll als externer Agent in Zed, VS Code usw. implementiert werden
können oder als eigenständiger Agent per Web erreichbar sein. Das LLM im
Hintergrund soll frei wählbar sein — per API, Subscription oder lokalem
Modell.

Syntax Bot soll verschiedene Modi haben:

1. **Syntax Fix** — korrigiert ausschließlich Rechtschreibfehler und
   Syntax-Fehler, keine weiteren Änderungen.
2. **Code Fix** — korrigiert Syntax-Fehler, verbessert die Code-Struktur und
   reduziert Fehler.
3. **Cleanup** — ändert den Code inhaltlich nicht (keine Logikänderungen
   o. Ä.), sondern verbessert ausschließlich die Struktur. Orientiert sich
   dabei an den Regeln für sauberen Code von Linus Torvalds für den
   Linux-Kernel (`coding-style.rst`,
   https://github.com/torvalds/linux/blob/master/Documentation/process/coding-style.rst).

Die drei Modi sollen als Pi-Agent-Extensions umgesetzt werden. Das heißt, man
würde z. B. `/syntax-fix` eingeben, um den Modus zu triggern, und müsste
danach nur noch auf den zu korrigierenden Code verweisen.

Syntax Bot basiert auf dem Pi Agent, soll dabei aber — falls vorhanden —
nicht eine bereits installierte Version nutzen, sondern eine eigene Instanz
verwenden, die immer die neueste Version des Pi Agents einsetzt.

Außerdem soll Syntax Bot mit allen Extensions, Skills und Prompt-Templates
des Pi-Ökosystems kompatibel sein. Das heißt, ich kann zu Syntax Bot sagen:
„Bitte installiere die Web-Access-Extension: `pi install npm:pi-web-access`",
und Syntax Bot installiert die Web-Access-Extension automatisch.

**Kerngedanke:** Wer mit einer LRS arbeitet, soll sich beim Programmieren auf
den Gedanken konzentrieren können statt auf Rechtschreibung und Syntax —
ohne dass der Agent sich in die eigentliche Logik des Codes einmischt, wenn
das nicht ausdrücklich gewünscht ist.

---

## The One Load-Bearing Idea

**Ein Modus ist eine Verhaltens-Einschränkung auf einem gemeinsamen Agenten —
kein eigenes Produkt.**

- Syntax Bot ist **ein** Pi-Agent mit **einer** Session-Engine. Es gibt kein
  separates Modell oder eine separate Codebasis pro Modus.
- Jeder Modus ist eine **Pi Extension**, die beim Triggern (`/syntax-fix`,
  `/code-fix`, `/cleanup`) einen festen System-Prompt-Fragment lädt und den
  Werkzeug-Zugriff (welche Tools der Agent nutzen darf) für diese Session
  einschränkt.
- Die Modi bilden eine aufsteigende Eingriffstiefe:
  `Syntax Fix ⊂ Code Fix`, während `Cleanup` orthogonal steht — breiter
  Zugriff auf Formatierung/Struktur, aber eine harte Grenze bei Logik.
- Einen neuen Modus hinzuzufügen heißt: neue Extension schreiben, neuen
  Slash-Command registrieren. Keine Änderung am Core-Agent nötig.

Das ersetzt eigene Fine-Tunes, separate Modelle oder mehrere Installationen —
Syntax Bot bleibt eine einzige, immer aktuelle Pi-Instanz mit austauschbaren
Verhaltensprofilen.

---

## Scope (v1)

### In

- **3 Modi** als Pi Extensions: `syntax-fix`, `code-fix`, `cleanup`, jeweils
  per Slash-Command getriggert.
- **Deployment:** eigenständiger Web-Agent zuerst, danach externer Agent für
  Zed, VS Code (weitere Editoren später möglich).
- **Web-Reichweite:** öffentlich erreichbares Chat-Interface mit
  Konto-Anmeldung (Multi-User); das Modell bringt jeder Nutzer selbst mit
  (BYOM: eigener API-Key, Browser-Anmeldung/Subscription oder eigener
  OpenAI-kompatibler Endpunkt, z. B. Ollama, LM Studio, llama.cpp).
- **Modellwahl frei:** API-Key, Subscription-Login (z. B. Claude Pro/Max,
  ChatGPT Plus/Pro, GitHub Copilot) oder lokales Modell — alles, was die
  Pi-Provider-Abstraktion unterstützt.
- **Eigene, isolierte Instanz** des Pi Coding Agent, unabhängig von einer
  eventuell bereits global installierten Version, die sich selbstständig auf
  dem neuesten Upstream-Release hält.
- **Volle Kompatibilität** mit dem Pi-Paket-Ökosystem: Extensions, Skills,
  Prompt-Templates lassen sich per natürlichsprachlicher Anweisung
  installieren (Syntax Bot übersetzt die Anfrage in `pi install …`).
- **Diff-Vorschau vor jeder Änderung** — der Agent schreibt nie ungefragt in
  Dateien.
- **Cleanup-Stilquelle** (`coding-style.rst`, Linux-Kernel) wird als
  Repo-Asset mitgeliefert statt als lokaler Pfad referenziert.

### Out (explizit, für v1)

- Cloud-Sync oder Backend für Syntax-Bot-eigene Daten — Zustand lebt lokal
  (analog zu Pis `~/.pi/agent/`).
- Vollautomatisches Anwenden von Änderungen ohne Bestätigung.
- Weitere Stilquellen für `Cleanup` jenseits des Linux-Kernel-Stils
  (z. B. PEP8, Google Style Guides) — später möglich, v1 bleibt bei einer
  Quelle.
- Eigenes/fine-getuntes Modell — Modellwahl läuft ausschließlich über die
  Pi-Provider-Abstraktion.
- Telemetrie/Analytics.

---

## Architecture

### Runtime / Instanz-Verwaltung

- Eigenes Home-Verzeichnis `~/.syntax-bot/agent/`, das Pi über die
  Umgebungsvariable **`PI_CODING_AGENT_DIR`** als Konfigurationsverzeichnis
  bekommt — komplett getrennt von einer eventuell vorhandenen globalen
  `pi`-Installation des Nutzers. Die Pi-Kopie selbst liegt daneben unter
  `~/.syntax-bot/runtime/` als eigene npm-Installation.
  *(Korrektur: Eine Variable `PI_HOME` gibt es in Pi nicht.)*
- **„Immer neueste Version"** wird bei jedem Start geprüft: Syntax Bot
  vergleicht die lokal vorgehaltene `@earendil-works/pi-coding-agent`-Version
  gegen die neueste npm-Version und aktualisiert bei Bedarf, bevor die
  Session startet (`scripts/bootstrap.mjs`). Abschaltbar über
  `SYNTAX_BOT_NO_UPDATE=1`, pinnbar über `SYNTAX_BOT_PI_VERSION`.
- **v1 startet die mitgelieferte Pi-CLI** und registriert dieses Repository als
  Pi-Paket in den Einstellungen der isolierten Instanz. Die Modi brauchen kein
  SDK-Embedding — sie sind reine Extensions. Das **Pi SDK**
  (`createAgentSession`, `ModelRuntime`, `SessionManager`) kommt erst für den
  Web-Agenten und die IDE-Anbindung ins Spiel (Phase 2), wo eine eigene
  Oberfläche den Lifecycle kontrollieren muss.

### Deployment-Oberflächen

1. **Web** — eigenständiger, browserbasierter Agent. Ein schlanker
   Server-Prozess (`node:http` + `ws`, kein Framework) hält pro Nutzer eine
   Pi-SDK-Session und spricht per WebSocket mit dem Frontend (Chat +
   Diff-Ansicht). Die Anmeldung läuft über lokale Konten (Registrierung/
   Login mit Nutzername, E-Mail und Passwort, scrypt-Hashes); ohne
   `SYNTAX_BOT_PUBLIC_BIND=1` bindet der Server nur auf `127.0.0.1`.
   Angemeldete Konten merken sich ihre Modell-Anbieter (API-Key,
   Browser-Anmeldung, eigener Endpunkt — je ein CredentialStore pro Konto)
   und ihre Thread-History (alte Threads sind über das ⋯-Menü mit vollem
   Modell-Kontext fortsetzbar); „ohne Konto fortfahren“ bleibt möglich,
   dann ohne Persistenz. Jede Session
   bekommt einen abgeschotteten Arbeitsbereich (Jail), `bash` ist im Web
   standardmäßig deaktiviert; HTTPS terminiert ein Reverse-Proxy.
   Angemeldete Nutzer erhalten einen dauerhaften Arbeitsbereich
   (`nutzer-<id>`), anonyme einen Wegwerf-Bereich; Rate-Limits und eine
   Obergrenze paralleler Verbindungen pro Nutzer bremsen Missbrauch.
2. **Externer Agent in IDEs (Zed, VS Code, …)** — Editor-Extension, die sich
   mit derselben laufenden Syntax-Bot-Instanz verbindet, sodass Kontext
   (offene Datei, Selektion) direkt übergeben werden kann, statt Code manuell
   einzufügen.

### Modellauswahl

- Delegiert vollständig an Pis eingebautes Provider-System: API-Key-Provider
  (Umgebungsvariablen / `auth.json`), Subscription-Logins (`/login`) sowie
  lokale Modelle (z. B. über Ollama-kompatible Endpunkte).
- Kein hart codiertes Standardmodell — Wahl pro Session oder als
  Nutzer-Default in der Konfiguration.
- Im Web-Agent gilt zusätzlich **BYOM**: Nutzer hinterlegen ihren Provider
  (OpenAI-kompatibel: API-Key oder Endpunkt wie Ollama/LM Studio/llama.cpp)
  in einem Einstellungsdialog. Schlüssel liegen ausschließlich im
  Arbeitsspeicher des Servers — nie auf Platte, nie in Logs.

### Modi als Pi Extensions

| Modus | Slash-Command | Erlaubte Änderungen | Tool-Zugriff |
|---|---|---|---|
| Syntax Fix | `/syntax-fix` | Nur Rechtschreibung + Syntax-Fehler | `read`, `grep`, `find`, `ls`, `edit` |
| Code Fix | `/code-fix` | Syntax-Fehler + Struktur + Fehlerreduktion | dazu `write` und `bash` (uneingeschränkt, für Tests) |
| Cleanup | `/cleanup` | Nur Struktur/Formatierung, **keine** Logik | wie Syntax Fix, dazu `bash` nur für Formatter/Linter |

Jede Extension lädt ihr eigenes System-Prompt-Fragment und beschränkt, was
der Agent in dieser Session anfassen darf. Nach dem Triggern muss der Nutzer
nur noch auf den zu bearbeitenden Code verweisen (Datei, Selektion oder
eingefügter Codeblock). `/syntax-fix src/parser.c` aktiviert den Modus und
übergibt den Auftrag in einem Schritt.

Zwei Präzisierungen gegenüber der ursprünglichen Fassung dieser Tabelle:

- **„Diff" ist kein Werkzeug**, sondern eine Leitplanke. Die Diff-Vorschau
  hängt nicht am Modus, sondern greift für jeden `write`- und `edit`-Aufruf —
  auch ohne aktiven Modus (siehe „Sicherheit / Leitplanken").
- **`write` ist in Syntax Fix und Cleanup abgeschaltet.** Beide Modi können
  jede erlaubte Änderung als gezielten `edit` ausführen. Ein vollständiges
  Überschreiben der Datei ist genau der Weg, auf dem in diesen Modi unbemerkt
  Logik verloren ginge — die Einschränkung folgt also der Absicht der Tabelle
  („minimal", „keine Logikänderung"), auch wenn sie deren Wortlaut verschärft.

Der aktive Modus wird als Session-Eintrag persistiert und beim Fortsetzen einer
Session wiederhergestellt. `/modus` zeigt den Stand, `/modus-aus` beendet ihn.

### Paket- / Extension-Verwaltung

- Syntax Bot stellt ein Meta-Tool bereit, das Installationswünsche aus
  natürlicher Sprache erkennt („Bitte installiere …") und daraus einen
  `pi install <paket>`-Aufruf ableitet.
- Da Pi-Extensions mit vollem Systemzugriff laufen (Sicherheitshinweis aus
  der Pi-Doku), **fragt Syntax Bot vor jeder Installation explizit nach
  Bestätigung** — auch wenn die Anfrage im Chat freundlich formuliert war.
- Weil Modi, Skills und Prompt-Templates alle einfach Pi-Pakete sind, erbt
  Syntax Bot die volle Ökosystem-Kompatibilität automatisch — es braucht
  keine eigene Kompatibilitätsschicht.

### Lokaler Zustand

- Sessions analog zu `~/.pi/agent/sessions/`, aber unter dem eigenen
  Syntax-Bot-Home-Verzeichnis.
- Konfiguration: Standardmodus, Standard-Modell/-Provider, Pfad zur
  Cleanup-Stilquelle, Diff-Vorschau an/aus, Auto-Update an/aus.

### Sicherheit / Leitplanken

- **Diff-first:** Vor jedem `write`- und `edit`-Aufruf wird der Diff berechnet
  und zur Bestätigung vorgelegt; erst danach wird geschrieben. Gerade als
  Hilfsmittel bei LRS wichtig — es sollen keine stillschweigend neuen Fehler
  entstehen. Pi selbst kennt keine solche Rückfrage (die eingebaute Diff-Ansicht
  erscheint erst *nach* der Änderung), deshalb ist das eine eigene Wache in
  `extensions/shared/diff-guard.ts`.
  - Sie hängt am Kern, nicht am Modus, und greift damit auch ohne aktiven Modus.
  - In Betriebsarten ohne Oberfläche (`-p`, `--mode json`) kann niemand
    bestätigen — dort werden Schreibvorgänge blockiert statt durchgewunken.
  - `--auto-apply` schaltet die Rückfrage bewusst ab.
- **Cleanup ist hart auf „keine Logikänderung" begrenzt.** Durchgesetzt wird das
  auf drei Ebenen: `write` ist abgeschaltet, `bash` läuft gegen eine Allowlist
  aus Formattern und Lintern (inklusive Sperre für Umleitungen und
  Kommando-Substitutionen, die die Allowlist umgehen würden), und das
  Prompt-Fragment benennt die Grenze explizit. Eine formale Äquivalenzgarantie
  gibt es in v1 nicht (siehe „Offene Punkte").
- **Paket-Installation:** Das Meta-Werkzeug `install_pi_package` ist der einzige
  Weg zu `pi install`. Es fragt bei jeder Installation ausdrücklich nach und
  lehnt ab, wenn keine Oberfläche für die Rückfrage da ist. Die Bestätigung ist
  nicht abschaltbar.
- **Web-Jail:** Im Web-Agent sind alle Pfad-Werkzeuge auf den
  Session-Arbeitsbereich eingeschränkt (`web/server/jail-extension.ts`);
  `bash` ist standardmäßig blockiert (Opt-in `SYNTAX_BOT_WEB_BASH=1`). Ein
  öffentlich betriebener Server darf diesen Schalter nicht setzen.

---

## Beispiel-Flow

```
> /cleanup
Cleanup-Modus aktiv — Struktur wird bereinigt, Logik bleibt unverändert.
Welcher Code soll bereinigt werden?

> @src/parser.c

[Diff-Vorschau: Einrückung, Klammernstil, Zeilenlänge
 gemäß Linux-Kernel coding-style.rst]

Änderungen übernehmen? [y/n]
```

---

## Design & UI-Konzept

Die Oberfläche von Syntax Bot — Web-Agent, IDE-Anbindung und CLI — folgt einer
Designsprache, die von Nothing-Produkten (Nothing OS, Nothing X, Nothing
Launcher) **inspiriert** ist: monochrom, rasterbasiert, Dot-Matrix-Typografie,
ein einzelner roter Akzent, sichtbare Technik statt dekorativer Flächen.

Die gesamte Umsetzung basiert ausschließlich auf frei lizenzierten
Alternativen. Es werden **keine** geschützten Nothing-Assets übernommen; die
Ästhetik ist eine eigenständige Interpretation.

### Lizenzgrenzen — nichts aus dem Nothing-Ökosystem wird übernommen

- **Keine Nothing-Fonts.** `NDot`, `NDots` und `Lite` sind proprietäre
  Schriften von Displaay und nicht frei lizenzierbar. Sie werden durch offene
  Alternativen ersetzt (siehe Typografie).
- **Keine Nothing-Assets, -Glyphen oder -Icons** aus Nothing OS / Nothing X /
  Nothing Launcher; alle Grafiken entstehen neu aus frei nutzbaren Quellen.
- **Keine Marken-Elemente:** „Nothing", das Punktraster-Logo und der
  Produktschriftzug werden nicht verwendet; Syntax Bot hat eine eigene
  Wortmarke (schlicht: `SYNTAX·BOT`, gesetzt in der Display-Schrift).
- **Erlaubte Eingangs-Lizenzen für alle Design-Assets:** MIT, SIL OFL,
  Apache-2.0, CC0. Für jedes übernommene Asset wird die Herkunft dokumentiert
  (analog zu `extensions/cleanup/styles/STYLE-SOURCE.md`).
- **Achtung Abgrenzung:** Die bereits gebündelte Cleanup-Stilquelle
  (`coding-style.rst`, GPL-2.0) ist eine Text-/Datenquelle, kein UI-Asset —
  sie berührt dieses Designkapitel nicht. Die offene Lizenzfrage des Repos
  bleibt davon unabhängig bestehen.

### Farbpalette (Tokens)

Monochromes Grundsystem, ein einzelner Akzent. Das Rot ist sparsam reserviert
für: aktiver Modus, unbestätigte Änderungen, destruktive Aktionen.

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0A0A0A` | Fläche |
| `--surface` | `#F4F4F4` | `#141414` | Karten, Panels |
| `--text` | `#111111` | `#EDEDED` | Primärtext |
| `--text-muted` | `#6B6B6B` | `#8A8A8A` | Sekundärtext, Labels |
| `--border` | `#D9D9D9` | `#2B2B2B` | Haarlinien, Raster |
| `--accent` | `#D71921` | `#FF3B30` | Einziger Farbakzent |
| `--diff-add` | `#1A7F37` | `#3FB950` | nur Diff: hinzugefügt |
| `--diff-del` | `#B42318` | `#F85149` | nur Diff: entfernt |

Grün/Rot sind ausschließlich der Diff-Ansicht vorbehalten und werden immer
mit Symbol/Text doppelt kodiert (nie Farbe allein, siehe Barrierefreiheit).

### Typografie

| Rolle | Schrift | Lizenz | Anmerkung |
|---|---|---|---|
| Display / Headers / Modus-Anzeige | **Doto** | SIL OFL | Punktraster-Schrift (Ryoichi Tsunekawa); funktional nächste offene Entsprechung der Nothing-Ästhetik, selbst kein Zitat einer geschützten Schrift |
| Code, Diff, Body | **JetBrains Mono** | Apache-2.0 | Regular + Bold; Ligen deaktiviert |
| Optional (Barrierefreiheit) | **OpenDyslexic** | Bitstream-Vera-Lizenz (frei) | Als umschaltbare Body-Alternative für LRS-Nutzer — passt zum Einsatzzweck des Bots |

- Schriftgrößen auf einem 4-px-Raster; Body-Grundgröße ≥ 17 px (Lesbarkeit),
  Zeilenhöhe Body 1,6, Code 1,5.
- Display-Schrift nur für kurze Labels (Titel, Modusname, Zähler) — nie für
  Fließtext.

### Icons & Grafik

- Icon-Satz: **Lucide** (ISC) oder **Phosphor** (MIT) als Inline-SVG,
  Strichstärke 1,5 px, 24-px-Raster.
- Zustände werden über Füllung/Deckkraft unterschieden, nicht über Farbe
  (Ausnahme: `--accent`).
- Das Dot-Raster dient als einziges Deko-Element: Punktraster als
  Hintergrund-Textur (reduzierte Deckkraft) und als Gliederungselement.

### Modus-Visualisierung

Die drei Modi werden als dreiteilige Dot-Leiste dargestellt:

```
Syntax Fix  ●○○
Code Fix    ●●○
Cleanup     ◐◐◐   (Umriss-Punkte: Zugriff, aber harte Logik-Grenze)
```

- Aktives Segment: `--accent`; inaktive Segmente: 40 % Deckkraft, nie Farbe.
- Jede Zustandsanzeige trägt zusätzlich ein Textlabel — Zustand ist nie
  farbcodiert allein.
- Die Leiste erscheint im Web-Header, im IDE-Statusbereich und in der CLI
  als einzeilige Ausgabe.

### Diff-Ansicht

- Links Zeilenmarkierung als Punkt statt Zeilennummer: `●` geändert, `○`
  unverändert.
- Hinzugefügte Zeilen: Fläche 12 % von `--diff-add` + linker Rand 2 px;
  entfernte Zeilen: analog mit `--diff-del`.
- Bestätigungsleiste („Übernehmen / Verwerfen") direkt unter dem Diff,
  primäre Aktion rechts, in `--accent`.
- Kein Syntax-Highlighting im Diff selbst — die Monochromie hält den Blick
  auf der Änderung; Highlighting nur in der Datei-Ansicht daneben.

### Barrierefreiheit (LRS-tauglich)

- Alle Kombinationen aus Vorder-/Hintergrund erfüllen WCAG AA (Kontrast
  ≥ 4,5:1 für Text).
- `prefers-reduced-motion` wird respektiert; Animationen sind ausschließlich
  opacity-/fade-basiert, ≤ 150 ms.
- Sichtbare Fokus-Ringe (2 px, `--accent`) auf allen interaktiven Elementen.
- Diff-Zeilen sind semantisch als Tabelle mit Rollen ausgezeichnet
  (Screenreader-tauglich).
- Systemschrift-Skalierung wird unterstützt (`--font-scale` von 0,875 bis
  1,5).

### Übertragung auf die Deployment-Oberflächen

1. **Web (Phase 2):** einspaltiges Chat-Layout mit Diff-Panel daneben
   (≥ 1024 px, darunter gestapelt); Kopfzeile mit Dot-Leiste und Modellname;
   keine Sidebar, kein Menü — alle Funktionen über Slash-Commands und die
   Leiste. Umsetzung mit Tokens als CSS Custom Properties, kein UI-Framework
   nötig.
2. **IDE (Zed, VS Code):** ausschließlich native Komponenten des Editors;
   Syntax Bot bringt nur Tokens (Theme-Farben, Statusleisten-Eintrag mit
   Dot-Leiste) ein und zeichnet nichts Eigenes über den Editor.
3. **CLI:** dieselben Tokens als Unicode-Punkte (`●○◐`) und 16-Farben-ANSI-
   Abbildung; Diff als Unified Diff mit Punkt-Markern statt `+`/`-`.

### Assets & Umsetzung

- Alle Tokens liegen in einer Datei `design/tokens.json` (MIT); Web und CLI
  generieren daraus ihre jeweiligen Formate (CSS-Variablen bzw. ANSI-Tabelle).
- Jede übernommene Schrift/Icon-Quelle wird mit Lizenz und Herkunft in
  `design/STYLE-SOURCE.md` dokumentiert — gleiches Prozedere wie bei der
  Cleanup-Stilquelle.

---

## Cleanup — Stilquelle

- Wird gebündelt als Repo-Asset ausgeliefert:
  `extensions/cleanup/styles/linux-kernel-coding-style.rst`, gespiegelt von
  https://github.com/torvalds/linux/blob/master/Documentation/process/coding-style.rst.
- **Nicht** als lokaler Pfad (`C:\Users\...\coding-style.rst`) referenziert —
  der ursprüngliche Pfad existiert nur auf einem Rechner und wäre in einem
  geteilten Repo/Paket nicht nutzbar.
- Version wird gepinnt: `styles/STYLE-SOURCE.md` hält Upstream-URL, Zeilenzahl,
  SHA-256 und Commit fest. `scripts/update-coding-style.sh` gleicht gegen den
  Upstream ab, zeigt standardmäßig nur den Diff und schreibt die Kennzahlen erst
  mit `--apply` zurück.
- **Lizenzhinweis:** Die Kernel-Dokumentation steht unter GPL-2.0. Solange die
  Datei mitgeliefert wird, hängt die offene Lizenzfrage des Repos daran.
- v1 nutzt diesen Stil sprachübergreifend als allgemeine
  „sauberer Code"-Philosophie, nicht nur für C — siehe offene Punkte.

---

## Repository Layout (Ziel)

```
syntax-bot/
├── Syntax-Bot-Specification.md   ← diese Datei
├── HANDOFF.md
├── README.md
├── package.json                  ← Pi-Paket-Manifest (pi.extensions)
├── extensions/
│   ├── core/index.ts             ← Diff-Guard, /modus, /modus-aus, Meta-Werkzeug
│   ├── shared/                   ← kein index.ts, wird nicht als Extension geladen
│   │   ├── mode-core.ts          ← Modus-Registry, Werkzeug-Grenzen, Persistenz
│   │   ├── bash-policy.ts        ← Allowlist für Formatter/Linter
│   │   ├── diff-guard.ts         ← Diff-Vorschau vor jedem Schreibvorgang
│   │   ├── package-install.ts    ← Meta-Werkzeug `pi install`
│   │   └── prompts/*.md          ← die System-Prompt-Fragmente der Modi
│   ├── syntax-fix/index.ts
│   ├── code-fix/index.ts
│   └── cleanup/
│       ├── index.ts
│       └── styles/
│           ├── linux-kernel-coding-style.rst
│           └── STYLE-SOURCE.md   ← Herkunft, Prüfsumme, Lizenz
├── web/                          ← Standalone Web-Agent
│   ├── server/                   ← index.ts (HTTP+WS), session-host.ts,
│   │                               ui-bridge.ts, jail-extension.ts,
│   │                               auth.ts, byom.ts
│   └── ui/                       ← index.html, app.js, style.css
├── design/                       ← tokens.json, STYLE-SOURCE.md
├── ide/                          ← Zed / VS Code (offen)
├── scripts/
│   ├── bootstrap.mjs             ← isolierte Instanz einrichten/aktualisieren
│   ├── syntax-bot.sh / .ps1      ← Start
│   ├── update-pi.sh / .ps1       ← Versionsprüfung
│   └── update-coding-style.sh    ← Stilquelle gegen Upstream abgleichen
└── test/
```

Pi entdeckt Extensions in einem Paket per Konvention als `extensions/*.ts` oder
`extensions/*/index.ts`. Deshalb heißen die Einstiegspunkte `index.ts` und nicht
`extension.ts`; `extensions/shared/` hat bewusst keinen, damit Pi den geteilten
Code nicht als vierte Extension lädt. Zusätzlich sind die vier Extensions in
`package.json` unter `pi.extensions` explizit aufgeführt.

---

## Entscheidungen — Fixiert

| Bereich | Entscheidung |
|---|---|
| Basis | Pi Coding Agent, eigene isolierte Instanz, immer neueste Version |
| Modi | 3: Syntax Fix, Code Fix, Cleanup — je eine Pi Extension |
| Trigger | Slash-Commands (`/syntax-fix`, `/code-fix`, `/cleanup`) |
| Deployment | Web (Standalone) + externer Agent in Zed/VS Code |
| Modellwahl | Frei: API-Key, Subscription oder lokales Modell |
| Paket-Kompatibilität | Volle Pi-Ökosystem-Kompatibilität (Extensions, Skills, Prompt-Templates) |
| Änderungen anwenden | Immer mit Diff-Vorschau, nie automatisch |
| Cleanup-Stilquelle | Linux-Kernel `coding-style.rst`, als Repo-Asset gebündelt |
| Cleanup-Grenze | Keine Logikänderungen, nur Struktur/Formatierung |
| UI-Design | Monochrome, von Nothing inspirierte Ästhetik mit einem roten Akzent; ausschließlich offene Lizenzen (MIT / OFL / Apache-2.0 / CC0), keine Nothing-Assets oder -Fonts |
| Web-Reichweite | Öffentlich erreichbarer Chat; öffentliches Binden nur mit `SYNTAX_BOT_PUBLIC_BIND=1` |
| Auth | Lokale Konten (Nutzername/E-Mail/Passwort, scrypt), Multi-User, HttpOnly+Secure Session-Cookie; „ohne Konto“ nur auf localhost |
| Konto-Gedächtnis | Pro Konto: gemerkte Modell-Anbieter (drei Wege wie in der IDE, eigener CredentialStore) + Thread-History mit Fortsetzen |
| Modell im Web | BYOM — eigener API-Key, Browser-Anmeldung (OAuth) oder OpenAI-kompatibler Endpunkt (Ollama, LM Studio, llama.cpp); pro Konto persistiert |
| Bash im Web | Standardmäßig blockiert; Opt-in nur per `SYNTAX_BOT_WEB_BASH=1` |
| HTTPS | Terminierung über Reverse-Proxy (Caddy/nginx), kein Zertifikats-Code im Server |

## Entscheidungen — Offen

- Weitere Stilquellen für `Cleanup` jenseits des Linux-Kernel-Stils
  (PEP8, Google Style Guides, …).
- ~~Genauer Update-Trigger für „immer neueste Pi-Version"~~ — **entschieden:**
  bei jedem Start, abschaltbar über `SYNTAX_BOT_NO_UPDATE=1`. Eine tägliche
  Hintergrundprüfung wäre eine Optimierung für Phase 3, kein v1-Thema.
- Sprache der eigenen Oberfläche (DE/EN, weitere?). Vorläufig: Slash-Commands
  der Modi bleiben englisch (`/syntax-fix`), Kern-Commands und alle Texte sind
  deutsch. Die Prompt-Fragmente weisen den Agenten an, in der Sprache des
  Nutzers zu antworten (Standard Deutsch).
- Umgang mit sehr großen Dateien/Repos, die den Kontext des Modells sprengen.
- Formale Prüfung der Logik-Unveränderlichkeit in `Cleanup` (aktuell nur
  best-effort über Linter/Formatter).
- ~~Auth-/Sicherheitsmodell für den Web-Standalone-Agent~~ — **entschieden:**
  lokale Konten (ersetzen das zuerst geplante GitHub-OAuth) + BYOM/Provider-
  Drei-Wege + Thread-History pro Konto; `bash` im Web standardmäßig
  blockiert, Pfad-Jail pro Session. Container-Isolation bleibt
  Phase-3-Kandidat.
- Lizenzmodell / Repo-Sichtbarkeit.
- ~~Konkrete Ausgestaltung der Design-Tokens~~ — **erledigt:**
  `design/tokens.json` ist kanonisch; der Generator (`scripts/generate-tokens.mjs`,
  `npm run tokens`) erzeugt `web/ui/tokens.css` und `design/tokens.ansi.json`,
  die Schriften sind gebündelt (`web/ui/fonts/`, Nachweise in
  `design/STYLE-SOURCE.md`), die OpenDyslexic-Umschaltung ist eingebaut.
  Offen bleibt nur die Wahl zwischen Lucide (ISC) und Phosphor (MIT) als
  Icon-Satz — aktuell kommt die UI ohne Icons aus.
