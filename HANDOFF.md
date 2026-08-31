# Syntax Bot — Projektübergabe (HANDOFF)

**Stand: 2026-08-24 · Phase 2d VS-Code-Extension funktionsfähig (eigenes Webview-UI mit Fußleiste, Modi, Export); Wurzel des Webview-Kanal-Bugs behoben; offene Rückmeldungen siehe unten**

> **📌 Rückmeldungen, die im nächsten Thread erwartet werden (Stand dieses Threads):**
> 1. LM-Studio-Anmeldung (`/login` → 3 → Endpunkt → `-` als Key → Modell per Ziffer) — Platzhalter-Key-Fix drin, vom Nutzer noch nicht bestätigt.
> 2. Modellantworten im Chat (inkl. Denkprozess-Block) mit gültigem Key — Fehler werden jetzt sichtbar gemeldet (mit Provider/Modell).
> 3. ⋯-Menü (inkl. Markdown-Export), Modus-Sync der Fußleiste, Modell-Aktualisierung nach Provider-Login — eingebaut, Bestätigung aussteht.
> 4. **Geplanter nächster Ausbau:** Zed-Modell-/Reasoning-Wahl nativ über ACP „Session Config Options" (vom Nutzer zugesagt).
>
> **Bekanntes Restrisiko:** Freie Provider-Modelle können leer antworten — wird jetzt sichtbar gemeldet statt Stille.

> **📌 Dauerregeln des Nutzers — gelten immer, ohne Nachfragen:**
>
> 1. **Antwort-Stil:** Erledigtes **sehr kurz und stichpunktartig** melden. **Ausführlich nur bei offenen Fragen und Entscheidungen**, die der Nutzer treffen muss — die für diese klar begründet werden.
> 2. **Sprache:** durchgehend Deutsch — UI (wenn relevant), Kommentare, Commits, diese Datei.
> 3. **Änderungen:** Änderungen am Code werden immer mit einer **Diff-Vorschau** (via Agent) vorgeschlagen. Der Agent schreibt nie ungefragt in Dateien.
> 4. **Sicherheit:** Vor jeder Installation von Pi-Paketen (via Meta-Tool) muss eine explizite Bestätigung des Nutzers eingeholt werden.
> 5. **Commit/Push:** Spätestens nach **drei Runden** wird alles committet und gepusht — außer es wird ausdrücklich verlangt, nicht zu pushen.

---

## 0. Schnelleinstieg für einen neuen Thread

**Das Projekt:** Ein Coding-Agent basierend auf dem [Pi Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent). Syntax Bot dient primär als Unterstützung für Nutzer mit LRS (Lese-Rechtschreib-Schwäche), indem er Syntax- und Rechtschreibfehler korrigiert, ohne die Programmlogik unkontrolliert zu verändern.

**Das Kerndesign ("The One Load-Bearing Idea"):**
Syntax Bot ist **ein** einziger Agent (eine Session), der seine unterschiedlichen Verhaltensweisen (Modi) über **Pi Extensions** realisiert. Ein Modus ist lediglich ein System-Prompt-Fragment + eine Einschränkung der Werkzeug-Rechte (Tools) innerhalb der bestehenden Pi-Session. Der Modus-Zustand ist **session-gebunden** (WeakMap, Schlüssel `ctx.sessionManager`), damit parallele Sessions in einem Prozess sich nicht gegenseitig stören.

**Wo:**
*   **Repository:** `c:\Users\gonk\Desktop\Syntax-Bot`
*   **Quelle der Wahrheit:** `Syntax-Bot-Specification.md` (Architektur und alle Entscheidungen).
*   **Design:** `design/tokens.json` (kanonische Tokens) + `design/STYLE-SOURCE.md` (Herkunft/Lizenzen).
*   **Einstieg für Benutzung:** `README.md`.

**Sofort loslegen:**

```powershell
.\scripts\syntax-bot.ps1          # startet Syntax Bot (richtet beim ersten Mal alles ein)
npm test                          # 105 Tests für Modus-Grenzen, Leitplanken, Web-Jail, Auth/BYOM/SSRF, ACP
npm run web                       # Web-Oberfläche: http://127.0.0.1:4711 (Port: SYNTAX_BOT_WEB_PORT)
node test/web-smoke.mjs 4711      # Smoke-Test gegen einen laufenden Web-Server
```

**Wichtigste Prinzipien:**
*   **Isolierte Instanz:** eigene Pi-Kopie unter `~/.syntax-bot/`, angebunden über `PI_CODING_AGENT_DIR` (**nicht** `PI_HOME` — die Variable existiert in Pi nicht).
*   **Immer aktuell:** Versionsprüfung bei jedem Start, abschaltbar per `SYNTAX_BOT_NO_UPDATE=1`.
*   **Diff-First:** jede Schreiboperation wird vorab als Diff bestätigt.
*   **Web-Jail:** im Web-Modus sind alle Pfad-Werkzeuge auf den Session-Arbeitsbereich eingeschränkt; `bash` ist standardmäßig blockiert.

---

## 1. Auftrag und die Entscheidungen dahinter

Das Ziel ist die Bereitstellung von drei spezifischen Modi als Pi Extensions:

| Modus | Slash-Command | Fokus | Werkzeuge |
|---|---|---|---|
| **Syntax Fix** | `/syntax-fix` | Nur Rechtschreibung + Syntax | `read`, `grep`, `find`, `ls`, `edit` |
| **Code Fix** | `/code-fix` | Syntax + Struktur + Fehlerreduktion | dazu `write`, `bash` (frei, für Tests) |
| **Cleanup** | `/cleanup` | Nur Struktur & Formatierung — **keine Logikänderung** | wie Syntax Fix, dazu `bash` nur für Formatter/Linter |

Dazu `/modus` (Stand anzeigen) und `/modus-aus` (Modus beenden).

**Entscheidungen:**
*   **Modelle:** Die Wahl des LLM (API, Subscription, Lokal) wird vollständig an das Pi-Provider-System delegiert.
*   **Stilquelle für Cleanup:** Linux-Kernel `coding-style.rst` (als Repo-Asset, gepinnt).
*   **Update-Trigger:** bei jedem Start.
*   **Web-Reichweite (fixiert, 2026-08):** Der Web-Agent ist als **öffentlich zugängliches Chat-Interface** umgesetzt — aber **BYOM** („bring your own model"): Jeder Nutzer bringt sein eigenes Modell mit (eigener API-Key oder lokaler Endpunkt, OpenAI-kompatibel: Ollama, LM Studio, llama.cpp). Der Server selbst hält keine Schlüssel auf Platte und rechnet nichts ab.
*   **Auth (fixiert und umgesetzt):** **OAuth / Multi-User** über GitHub. Ohne GitHub-Zugangsdaten (`SYNTAX_BOT_GITHUB_CLIENT_ID/SECRET`) bleibt der Server Einzelnutzer-Betrieb und bindet nur auf `127.0.0.1` — öffentliches Binden ohne OAuth verweigert er (`exit 1`).
*   **Bash im Web (fixiert):** standardmäßig **gesperrt**; Opt-in nur per `SYNTAX_BOT_WEB_BASH=1`.
*   **Design (fixiert):** Oberfläche nach Spec „Design & UI-Konzept" — Nothing-inspiriert, monochrom mit einem roten Akzent, Dot-Matrix-Typografie (Doto/JetBrains Mono), Tokens in `design/tokens.json`. Keine geschützten Nothing-Assets.

---

## 2. Stand

**Erledigt:**
*   [x] **Phase 1 komplett** — drei Modi als Extensions, Diff-Guard, Meta-Tool, Stilquelle, isolierte Instanz, Tests.
*   [x] **Phase 2a — Web-Grundgerüst:**
    *   Modus-Zustand **session-gebunden** (`extensions/shared/mode-core.ts`, WeakMap über `ctx.sessionManager`) statt global — parallele Sessions sind jetzt möglich.
    *   **Web-Jail** (`web/server/jail-extension.ts`): sperrt Pfad-Werkzeuge auf den Session-Arbeitsbereich ein (`resolve` + `relative`-Prüfung), blockt `bash` ohne Opt-in. 9 Tests.
    *   **Web-Server** (`web/server/`): statisches HTTP für die UI + WebSocket unter `/ws`; pro Verbindung eine eigene `AgentSession` mit eigenem Arbeitsbereich unter `~/.syntax-bot/web-workspaces/`.
    *   **UI-Bridge** (`web/server/ui-bridge.ts`): setzt `ExtensionUIContext` auf WS-Roundtrips um (`confirm`/`select`/`input` mit requestId). Damit meldet der Runner `hasUI === true` und der Diff-Guard läuft unverändert — die Diff-Rückfrage landet im Browser.
    *   **Web-UI** (`web/ui/`, deutsch): Chat + Dialog-Diff-Vorschau, XSS-sicher (nur `textContent`), LRS-tauglich und nach Spec-Design (Tokens, Dot-Leiste für Modi, Punkt-Markierung im Diff, `Übernehmen/Verwerfen` rechtsbündig).
    *   Smoke-Test `test/web-smoke.mjs` (HTTP + WS-Protokoll + Slash-Command).
*   [x] **Phase 2b — Auth & BYOM:**
    *   **GitHub-OAuth** (`web/server/auth.ts`): Authorization-Code-Flow serverseitig mit `state`-CSRF-Schutz, HttpOnly-Session-Cookie (`SameSite=Lax`, `Secure` per `SYNTAX_BOT_SECURE=1`), Login-Gate (alle Seiten ohne gültige Session liefern `login.html`).
    *   **Nutzer → Workspace:** angemeldete Nutzer bekommen einen dauerhaften Arbeitsbereich `~/.syntax-bot/web-workspaces/nutzer-<id>`; anonyme Localhost-Verbindungen bleiben Wegwerf-Bereiche.
    *   **Missbrauchs-Schutz:** Rate-Limit auf `/auth/login` (20/min/IP, Schiebefenster), max. parallele WS-Verbindungen pro Nutzer (`SYNTAX_BOT_MAX_SESSIONS`, Standard 2, geprüft im WS-Handshake `verifyClient`), Drossel für BYOM-Verbindungstests (5/min/Verbindung).
    *   **BYOM** (`web/server/byom.ts` + „Modell“-Knopf in der Kopfzeile): Einstellungsdialog mit Endpunkt/API-Key/Modell-ID, Test-Knopf ruft die Modell-Liste ab (OpenAI- und Ollama-Format), Speichern registriert den Provider über `session.modelRuntime.registerProvider(...)` und setzt das Modell. **API-Keys liegen nur im Arbeitsspeicher** — keine Persistenz, kein Logging; nach Server-Neustart erneut eingeben.
    *   18 neue Tests (`test/web-auth.test.ts`), Smoke-Test um BYOM-Prüfungen erweitert.
*   [x] **Design-Nacharbeiten (2026-08-23):**
    *   **Token-Generator** (`scripts/generate-tokens.mjs`, `npm run tokens`): erzeugt `web/ui/tokens.css` (Light/Dark-CSS-Variablen) und `design/tokens.ansi.json` (16-Farben-Zuordnung für die spätere CLI) aus `design/tokens.json`. `style.css` enthält keine handgespiegelten Farbwerte mehr.
    *   **Schriften gebündelt:** `web/ui/fonts/` — Doto (Variable, OFL), JetBrains Mono Regular+Bold (v2.304, Apache-2.0), OpenDyslexic Regular (OFL 1.1, Fontsource 5.3.0). Prüfsummen und Herkunft: `design/STYLE-SOURCE.md`.
    *   **OpenDyslexic-Umschalter:** Knopf „LRS-Schrift" in der Web-Kopfzeile, Zustand in `localStorage`, nur Fließtext wechselt (Spec bleibt Dot-Matrix).
    *   **SSRF-Schutz für BYOM** (`pruefeEndpunkt` in `web/server/byom.ts`): Metadaten-/Link-local-/Reserve-/Multicast-/CGNAT-Adressen sind immer blockiert — auch als DNS-Antwort eines Hostnamens; IPv4-gemappte IPv6-Tricks abgedeckt. Loopback/RFC1918 bleiben erlaubt (lokale Modelle!). `SYNTAX_BOT_BYOM_STRICT=1` blockiert zusätzlich alle privaten Bereiche (für öffentliche Server). 5 neue Tests.
*   [x] **Phase 2c — IDE-Anbindung Zed (2026-08-23):**
    *   **ACP-Adapter** (`ide/index.ts`, `npm run ide`): Syntax Bot spricht den Agent Client Protocol (JSON-RPC 2.0 über stdio) und wird von Zed als External Agent gestartet (`agent_servers` in der settings.json, Anleitung im README).
    *   **Framing** (`ide/acp.ts`): abhängigkeitsfreie ndjson-JSON-RPC-Schicht, in Tests mit gekreuzten Speicher-Verbindungen getrieben.
    *   **Adapter** (`ide/adapter.ts`): pro ACP-Session eine echte Pi-AgentSession (SDK, wie im Web), Arbeitsmappe = Projektordner des Editors; die drei Modi werden als ACP-Modi (`session/set_mode`) und Slash-Commands (`available_commands_update`) angeboten und intern als Pi-Commands ausgeführt — ein einziger Pfad für TUI/Web/IDE.
    *   **UI-Brücke** (`ide/ui-bridge.ts`): `confirm()` des Diff-Guards wird zu `session/request_permission` → nativer Übernehmen/Verwerfen-Dialog in Zed; select/input lehnt die IDE bewusst ab.
    *   10 neue Tests (`test/ide-acp.test.ts`). Bewusst **nicht** `pi-acp` benutzt: dessen Adapter unterstützt keine Extension-Slash-Commands — die Modi wären weggefallen.
*   [x] Test-Suite: **105 Tests, alle grün** (`npm test`).
*   [ ] Nächster Schritt: **Phase 2d vertiefen** — manuelle Erprobung in VS Code (ACP Client), danach ggf. Zed/VS-Code-Unterschiede im Adapter glätten.
*   [x] Lauffähig: `scripts/syntax-bot.ps1` (CLI) und `npm run web` (Web).

**Was in früheren Durchgängen inhaltlich korrigiert wurde (Phase 1):**
1.  Die drei alten Extensions waren gegen eine **nicht existierende Pi-API** geschrieben. Vollständig neu implementiert — geprüft gegen `@earendil-works/pi-coding-agent@0.84.1`.
2.  **Es gab keinerlei Werkzeug-Einschränkung.** Jetzt: `setActiveTools` plus zweite Verteidigungslinie im `tool_call`-Ereignis.
3.  **`PI_HOME` existiert nicht.** Die richtige Variable heißt `PI_CODING_AGENT_DIR`.
4.  Zeile 1 der Stilquelle lautete `x.. _codingstyle:` — das verirrte `x` ist entfernt.

---

## 3. Struktur (Ist-Zustand)

```
syntax-bot/
├── Syntax-Bot-Specification.md   ← Quelle der Wahrheit
├── HANDOFF.md                    ← diese Datei
├── README.md                     ← Benutzung
├── package.json                  ← Pi-Paket-Manifest, „web"-Skript
├── extensions/
│   ├── core/index.ts             ← Diff-Guard, /modus, /modus-aus, Meta-Werkzeug
│   ├── shared/                   ← geteilter Code, absichtlich ohne index.ts
│   │   ├── mode-core.ts · bash-policy.ts · diff-guard.ts · package-install.ts
│   │   └── prompts/{syntax-fix,code-fix,cleanup}.md
│   ├── syntax-fix/index.ts
│   ├── code-fix/index.ts
│   └── cleanup/index.ts + styles/
├── web/
│   ├── server/                   ← index.ts (HTTP+WS+OAuth), session-host.ts,
│   │                               auth.ts, byom.ts, ui-bridge.ts, jail-extension.ts
│   └── ui/                       ← index.html, login.html, app.js, style.css (Spec-Design)
├── design/                       ← tokens.json, STYLE-SOURCE.md
├── scripts/                      ← bootstrap.mjs, syntax-bot.*, update-pi.*, update-coding-style.sh
└── test/                         ← 82 Tests + web-smoke.mjs
```

`ide/` existiert noch nicht — es kommt nach Phase 2.

---

## 4. Roadmap (Arbeitsplan)

### Phase 1: Core & Modi — **abgeschlossen**
*   [x] Drei Modi als Pi Extensions, System-Prompts, Meta-Tool, Stilquelle.
*   [x] Isolierte Instanz, Start-/Update-Skripte, Diff-Guard, Tests.

### Phase 2a: Web-Grundgerüst — **abgeschlossen**
*   [x] Session-gebundener Modus-Zustand.
*   [x] Web-Jail mit Ausbruch-Tests.
*   [x] Web-Server (HTTP + WebSocket, SDK-Session, UI-Bridge).
*   [x] Web-UI (Chat + Diff-Dialog, deutsch, Spec-Design).
*   [x] Spec/HANDOFF nachgezogen (diese Datei; Spec-Update folgt noch).

### Phase 2b: Auth & BYOM — **abgeschlossen**
*   [x] OAuth / Multi-User: GitHub-Login, Session-Cookie, Login-Gate; öffentliches Binden nur mit OAuth.
*   [x] BYOM-Verwaltung im Web: Einstellungsdialog + Verbindungstest, Provider auf `ModelRuntime` der Session, Keys nur im RAM.
*   [x] Workspace-Konzept (Grundstufe): angemeldete Nutzer haben dauerhafte Bereiche `nutzer-<id>`. Offen bleibt die Repo-Anbindung (Nutzer-Repos in den Workspace holen).

### Phase 2c: IDE-Anbindung Zed — **Grundgerüst + Vertiefung abgeschlossen (2026-08-23)**
*   [x] ACP-Adapter für Zed (`ide/`), Modi als Slash-Commands und Modus-Umschalter, Diff-Rückfrage als nativer Berechtigungsdialog.
*   [x] Session-Wiederherstellung (`session/load`, Mapping ACP→Pi-Session unter `~/.syntax-bot/ide-sessions.json`) und Kontextübergabe: `@datei`-Verweise aus Zed kommen als `resource_link` und werden zu Pi-tauglichen Pfaden übersetzt.
*   [x] Manuelle Erprobung in Zed (2026-08-23): Einrichtung und Modi-Umschalter funktionieren. Fehler dabei gefunden und behoben: (1) Command-Namen ohne führenden Schrägstrich; (2) Prompt-Fehler als Klartext statt ACP-"refusal"; (3) `available_commands_update` erst **nach** der session/new-Antwort senden — vorher verwarfen Clients das Popup still.
*   [x] IDE-eigene Commands (2026-08-23, erweitert): Command-Katalog mit 19 Einträgen im „/“-Popup, dreistufig umgesetzt — **nativ** (`/model` Liste+Wechsel, `/login`, `/logout`, `/new`, `/compact`, `/tools`, `/stats`, `/reload`, `/settings`, `/help`), **Pi-Passthrough** (Modi-Commands an die Extensions) und **TUI-Fallback** (`/resume`, `/tree`, `/share`, `/theme` — nur im Terminal sinnvoll, Adapter erklärt das).    Login läuft **komplett im Chat, geführt** (2026-08-23 erweitert): `/login` zeigt einen Drei-Wege-Dialog (1 API-Key / 2 Browser / 3 eigener Endpunkt), Provider werden aus `modelRuntime.getProviders()` inkl. Auth-Fähigkeit aufgelistet und per Ziffer oder Name gewählt; **OAuth/Subscription (Claude Pro/Max & Co.) funktioniert jetzt ebenfalls direkt in der IDE** — der Adapter leitet die Auth-Ereignisse des Providers (`auth_url`, `device_code`, `progress`) als Chat-Nachrichten durch, Pi übernimmt Callback/Abfrage selbst; `/login custom` führt durch den eigenen OpenAI-kompatiblen Endpunkt (wiederverwendet `web/server/byom.ts`). Wichtiger Stolperstein: Der Chat-Fragen-Fluss darf die session/prompt-Antwort nicht blockieren (Deadlock im Editor) — Fragen laufen detached, Antworten landen in einem Puffer, aus dem sich Provider-Nachfragen (`interaction.prompt`) bedienen.
*   [x] `/settings` als vollständiger Dialog im Chat (2026-08-23): **alle Optionen des CLI-Einstellungsdialogs** (Auto-compact bis Warnings, 29 Einträge) sind hier umgesetzt — tabellengetrieben über `pi.settingsManager`, Boolesche Werte kippen direkt per Ziffer, Aufzählungen fragen ihre Optionen ab, alles wird persistiert. Reine TUI-Ansichten (Theme-Auswahl, Warnings-Konfigurator, TUI-Modus) sind als nur-im-Terminal gekennzeichnet. Menü wiederholt sich nach jeder Änderung; beliebige Nicht-Ziffer beendet ihn.
*   [ ] **Qoder-Abo als Login-Option: nicht möglich** (2026-08-23 recherchiert). Qoder stellt seine Abo-Modelle nicht als öffentliche API bereit (nur Cloud-Agents-Management-API mit PAT/SAT und die eigenen IDE-/CLI-Clients). Einziger inoffizieller Weg: Anthropic-kompatible Proxys Dritter über qodercli — dafür ist Syntax Bot zu sicherheitsbewusst; Nutzer können solche Proxy-Endpunkte bei Bedarf selbst über `/login custom` eintragen.

### Phase 2d: IDE-Anbindung VS Code — **Grundgerüst abgeschlossen (2026-08-23)**
*   [x] **Entscheidung: Community-Extension statt Eigenbau.** Evaluiert: [ACP Client](https://marketplace.visualstudio.com/items?itemName=formulahendry.acp-client) (`formulahendry.acp-client`, MIT, aktiv gepflegt, 26k+ Installationen). Unterstützt eigene Agents per `acp.agents`-Einstellung (`command`/`args`/`env`), Slash-Command-Popup, Modus-/Modell-Wahl und Berechtigungsdialoge — deckt genau die ACP-Fläche ab, die der bestehende Adapter aus Phase 2c bedient. Ein eigenes Bridge-Panel wäre Doppelarbeit.
*   [x] Der Adapter (`ide/index.ts`) bleibt unverändert — VS Code ist reiner Konfigurationsfall: Extension installieren, `acp.agents` → Syntax Bot → `node ide/index.ts`. Anleitung im README (inkl. „ACP: Show Protocol Traffic" zur Fehlersuche).
*   [x] Manuelle Erprobung in VS Code (2026-08-23): Einrichtung über „ACP Client" funktioniert. Gefundener und behobener Fehler: Der Adapter schickte bei jedem `message_update` den **kompletten** Text als Chunk — ACP verlangt Deltas; die VS-Code-Extension hängt Chunks an, wodurch sich Texte verdoppelten und das Markdown-Endrendering (Links & Co.) danebenging. `IdeAcpSession` sendet jetzt nur den Zuwachs (`gesendet`-Zähler), neuer Delta-Test in `test/ide-acp.test.ts` (106 Tests grün).
*   [x] **Eigenständige VS-Code-Extension (2026-08-23, Entscheidung: eigene Chat-Webview).** `vscode/` — Pi-Laufzeit + ACP-Adapter werden mit esbuild in die VSIX gebündelt (`npm run build:vscode`, 11 MB; AWS-SDK wird weggetrimmt), laufen im Extension-Host statt als Unterprozess. Kein Node, kein `~/.syntax-bot`, keine CLI nötig — Zielgruppe Schul-Rechner.
    *   ACP in-process: zwei gekreuzte `AcpVerbindung`-Instanzen (Muster aus den Tests); `session/request_permission` wird zur Übernehmen/Verwerfen-Karte im Webview.
    *   Konfig-Home: `<globalStorage>/agent`, `settings.json` trägt die mitgelieferten Extensions ein (`dist/pi-package/`, Kopie von `extensions/` samt Manifest — entspricht `ensurePackageRegistered` ohne Repo auf Platte).
    *   Webview nach Spec-Design: Dot-Leiste (●○○/●●○/◐◐◐), Markdown-Rendering handgerollt und XSS-sicher, Werkzeug-Anzeige, `prefers-reduced-motion` beachtet.
    *   Fallstricke beim Bündeln: Pi liest `import.meta.url` → per esbuild `define`+`inject` ersetzt; photon-node lädt sein WASM über `__dirname` → liegt als echtes Paket neben dem Bundle; `vscode` ist external.
    *   End-to-End-Test gegen das Bundle (`test/vscode-extension.test.ts`, vscode-Stub): Session-Start mit echtem Pi und `/help` über die Webview-Pipeline. **108 Tests grün.**
    *   Erprobung mit dem Nutzer (2026-08-24): Kern läuft. Wichtige Erkenntnisse: (1) Webview-Ressourcen über `asWebviewUri` bleiben je nach VS-Code-Build hinter der CSP hängen — **CSS/JS/Schriften werden jetzt direkt ins HTML eingebettet** (Schriften als data-URI). (2) Ohne geöffneten Ordner darf `cwd` nicht `homedir()` sein (Pi kann beim Scan hängen) — Fallback ist `globalStorage/workspaces/standard`. (3) Adapter um `session/status`, `session/set_model`, `session/set_thinking` erweitert (Modell, Thinking-Stufe, Kontext-Füllstand für Editor-Fußleisten). (4) Webview: Zed-artige Fußleiste (+ / Kontext / Modell / Think / Modus / Senden), „/“-Popup mit Command-Vervollständigung, Popup-Menüs, Diagnose-Stempel und sichtbare JS-Fehler.
    *   **Die eigentliche Wurzel des „stummen Chat"-Bugs gefunden (2026-08-24, per automatisiertem VS-Code-Lauf mit Ping/Pong-Harness):** Das Webview-Skript definierte eine globale Funktion `postMessage(...)` — die **überschattet `window.postMessage`**, und genau diese Methode ruft VS Codes injizierte Messaging-Bridge, um Host-Nachrichten in die Seite zu stellen. Jede eingehende Nachricht landete dadurch im eigenen Wrapper und wurde sofort zurück zum Host gespiegelt, statt beim Handler anzukommen. Fix: Funktion heißt jetzt `sendeAnHost` (mit Warnkommentar). Zusätzlich: Host puffert alle Nachrichten bis zur `hello`-Anmeldung der Seite (postMessage vor der Listener-Registrierung wird von VS Code verworfen, siehe microsoft/vscode#125546), Polling-Fallback mit Sequenznummern, Stop-Entblock-Sicherheitsnetz. Verifiziert per `vscode/harness.js` (startet echtes VS Code, misst Ping/Pong) — PONG bestätigt.
    *   **Nacharbeiten (2026-08-24):** Modus-Wechsel per Slash-Command werden jetzt als `current_mode_update` nachgemeldet (Fußleiste bleibt synchron); Adapter-Notification `syntax-bot/refresh` nach Login/Logout/Modell-/Thinking-Wechsel → VS-Code-Fußleiste aktualisiert Modelle sofort ohne `/model`; ⋯-Menü mit korrekter Positionierung (Kopfzeilen-Anker öffnen das Menü darunter) und **Thread-Export als Markdown** (Save-Dialog); Leerantwort-Erkennung (Zug ohne sichtbare Antwort → Hinweis statt Stille). Harness-Lauf bestätigt Ping/Pong auch im Finalstand. Offen beobachtet: Freie Modelle (z. B. deepseek-v4-flash-free über OpenCode Zen) antworteten auf `/syntax-fix @datei` einmal leer — wird jetzt wenigstens sichtbar gemeldet. Zed zeigt Modell/Thinking/Kontext in seiner eigenen UI und ignoriert die Custom-Notification; ein VS-Code-artiges Eigen-UI in Zed wäre nur gegen den nativen Panel-Ansatz möglich.
    *   **Stumme Modellaufrufe erklärt (2026-08-24, per `scripts/debug-modell.mjs`):** Pi wirft bei Provider-Fehlern NICHT, sondern liefert die Assistant-Message mit `stopReason:"error"` + `errorMessage` (im Repro: `401 Invalid API key` eines abgelaufenen OpenCode-Zen-Keys). Der Adapter reicht das jetzt als Fehlermeldung durch und leitet zusätzlich Denk-Protokolle als `agent_thought_chunk` weiter (Webview zeigt sie als gedämpften „Denkprozess"-Block). Weiterer Fix: Der Document-Click-Handler schloss das ⋯-Menü sofort (Kopfzeilen-Knopf hatte nicht die erwartete CSS-Klasse). Nächster Schritt (vom Nutzer gewünscht): Zed-Modell-/Reasoning-Wahl nativ über ACP „Session Config Options" im Adapter advertise-n.
    *   **Provider-/Auth-Verwirrung behoben (2026-08-24):** Der 401 im Feld kam daher, dass das gewählte Modell zu einem ANDEREN Provider gehörte als der neu eingegebene Key (alter ungültiger Key blieb aktiv). Jetzt: Nach Login wird automatisch das erste Modell **des angemeldeten Providers** aktiviert; Modell-Katalog (Fußleiste, `/model`, `session/set_model`) zeigt nur noch Modelle **authentifizierter** Provider (`getProviderAuthStatus().configured`); `/logout` ohne Argument listet angemeldete Provider interaktiv und warnt, wenn das aktive Modell betroffen ist; Modellfehler nennen jetzt Provider/Modell (z. B. „opencode/deepseek…: 401 …"). Zusätzlich: Slash-Commands brechen eine offene Chat-Rückfrage kontrolliert ab (vorher verschlang ein hängender Login-Dialog `/settings`); `auth.json` beider Instanzen wurde als Fehlerquelle geleert (Backups `.backup`). Leere Antworten auf Chat-Rückfragen sind jetzt gültig (Webview sendet bei leerer Eingabe `-`; Adapter behandelt `-`/leer als „kein Key" — nötig für LM Studio & Co. ohne API-Key). `/login custom` fragt jetzt die Modellliste direkt am Endpunkt ab (`fetchRemoteModels`) und bietet Auswahl per Ziffer — vorher musste die Modell-ID blind getippt werden, und ein versehentliches `/model` im Dialog brach ihn ab (Slash-Commands brechen offene Rückfragen bewusst ab). **Wurzel des „eigener Endpunkt"-Versagens (per `scripts/debug-byom.mjs` gegen echtes LM Studio nachgewiesen):** Pi listet Provider **ohne Credentials gar nicht erst** (`getProviderAuthStatus().configured === false` → `getAvailable()` = 0) — keylose lokale Endpunkte (LM Studio/Ollama) bekommen deshalb einen Platzhalter-Key („kein-key", wird vom Endpunkt ignoriert).
*   [ ] Manuelle Erprobung der Extension in VS Code (VSIX bauen, installieren, Chat/Diff/Modi durchspielen) und Verpackungsdetails (Publisher-ID für den Marketplace).

### Phase 3: Ökosystem & Stabilität
*   [ ] Kompatibilität mit allen Pi-Skills und -Templates prüfen.
*   [ ] Test-Suite gegen ein echtes Modell (heute Stub — prüft Grenzen, nicht Prompt-Qualität).
*   [ ] Formale Prüfung der Cleanup-Logik-Invarianz (AST-Vergleich).
*   [ ] Auto-Update optimieren (tägliche Hintergrundprüfung statt bei jedem Start).

---

## 5. Offene Punkte (Entscheidungsbedarf)

1.  **Lizenz und Repo-Sichtbarkeit.** Die mitgelieferte Kernel-Stilquelle steht unter **GPL-2.0**. Solange sie im Repo liegt, hängt daran, welche Lizenz Syntax Bot selbst haben kann. Alternativen: (a) GPL-kompatibel lizenzieren, (b) Datei erst beim ersten Start herunterladen, (c) eigene frei formulierte Stilzusammenfassung.
2.  **UI-Sprache.** Vorläufig gesetzt: Modus-Commands englisch (`/syntax-fix`, spec-fixiert), Kern-Commands und Texte deutsch, der Agent antwortet in der Sprache des Nutzers. Für eine Veröffentlichung wäre Englisch als Grundsprache mit deutscher Übersetzung der sauberere Weg.
3.  **Web-Betrieb (neu):** Die Auth-/BYOM-Umsetzung ist da, aber **nur auf localhost automatisch geprüft** — der GitHub-OAuth-Durchlauf (Callback, Cookie hinter HTTPS-Proxy) braucht echte Zugangsdaten und ist manuell zu testen. Benötigte Umgebungsvariablen: `SYNTAX_BOT_GITHUB_CLIENT_ID`, `SYNTAX_BOT_GITHUB_CLIENT_SECRET`, `SYNTAX_BOT_PUBLIC_URL`, `SYNTAX_BOT_SECURE=1` (hinter HTTPS), `SYNTAX_BOT_TRUST_PROXY=1` (X-Forwarded-For auswerten).
4.  ~~Design-Assets vervollständigen~~ — **erledigt (2026-08-23):** Schriften liegen unter `web/ui/fonts/` (Prüfsummen in `design/STYLE-SOURCE.md`), der Token-Generator läuft per `npm run tokens`, die OpenDyslexic-Umschaltung ist eingebaut. Offen bleibt nur die Icon-Satz-Wahl (Lucide vs. Phosphor) — aktuell braucht die UI keine Icons.
5.  **Cleanup-Verifizierung.** Aktuell drei Ebenen (kein `write`, Bash-Allowlist, Prompt-Grenze) — best-effort. Eine echte Garantie bräuchte AST-Vergleich vor/nach der Änderung. Lohnt sich das für v1?
6.  **Umgang mit sehr großen Dateien**, die den Kontext sprengen — unverändert offen.
7.  ~~Eigenständige VS-Code-Extension~~ — **umgesetzt (Grundgerüst, 2026-08-23):** `vscode/`, gebündelte Pi-Laufzeit, eigene Chat-Webview, globalStorage als Home. Offen: manuelle Erprobung und Publisher-ID für eine Marketplace-Veröffentlichung. Beachte: „Immer neueste Pi-Version" gilt hier nicht — die Pi-Version kommt mit dem Extension-Update.

---

## 6. Fallen (Risiken)

*   **Modus-Drift:** entschärft, aber nicht beseitigt. Die Werkzeug-Grenzen sind hart durchgesetzt; *innerhalb* der erlaubten Werkzeuge hält nur der Prompt den Agenten davon ab, im Syntax-Fix-Modus per `edit` doch Logik zu ändern. Der Diff-Guard ist die letzte Instanz.
*   **Bash im Web:** im Web-Modus ist `bash` standardmäßig blockiert (Jail), auch in Modi, die es sonst erlauben würden. Bewusstes Opt-in nur per `SYNTAX_BOT_WEB_BASH=1` — dann gilt weiterhin die Modus-Policy. Wer den Server öffentlich betreibt, darf diesen Schalter nicht setzen.
*   **Node-TS-Fallstrick:** Der Server läuft direkt unter Node ≥ 22.18 im Strip-only-Modus. **Keine Constructor-Parameter-Properties** (`constructor(private x: …)`) und keine Enums — Node lehnt beides mit `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` ab. Explizite Felder + Zuweisung im Konstruktor verwenden.
*   **Abhängigkeit `ws`:** kommt aus dem verschachtelten `node_modules` der isolierten Pi-Instanz und wird per `test/link-deps.mjs` verlinkt — nicht aus dem npm-Registry-Install. Bei neuer Pi-Version prüfen, ob `ws` noch da ist.
*   **Version-Mismatch:** Pi wird bei jedem Start auf `latest` gezogen. Eine Breaking Change in der Extension-API bricht Syntax Bot dann sofort. Gegenmittel: `SYNTAX_BOT_PI_VERSION` pinnen.
*   **Installation-Sicherheit:** unverändert kritisch, aber abgedeckt — `install_pi_package` ist der einzige Weg zu `pi install`, und die Rückfrage ist nicht abschaltbar.
*   **BYOM-Endpunkte sind SSRF-Fläche:** entschärft (2026-08-23) durch `pruefeEndpunkt`: Metadaten-/Link-local-/Reserve-/Multicast-/CGNAT-Bereiche sind immer blockiert, inklusive DNS-Auflösungsprüfung und IPv4-gemappter IPv6-Tricks; Restrisiken bleiben Timeout/Drossel plus der bewusste Allowlist-Bereich für lokale Modelle (Loopback/RFC1918). Öffentliche Server sollten `SYNTAX_BOT_BYOM_STRICT=1` setzen.
*   **Keys nur im RAM:** BYOM-Konfiguration wird bewusst nicht persistiert — nach jedem Server-Neustart müssen Nutzer Endpunkt/Key neu eingeben. Das ist gewollt (Spec), darf nicht „bequemlichkeitshalber" geändert werden.
