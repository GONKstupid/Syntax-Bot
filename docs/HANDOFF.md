# Syntax Bot — Projektübergabe (HANDOFF)

**Stand: 2026-09-03 · Cleanup-Stilquelle entfernt: die GPL-2.0-lizenzierte `linux-kernel-coding-style.rst` (ursprünglich nur als Beispiel gedacht) ist samt `STYLE-SOURCE.md` und `scripts/update-coding-style.sh` raus; der Cleanup-Modus stützt sich jetzt auf die eigene 7-Punkte-Zusammenfassung im Prompt (`cleanup.md`, `{{STYLE_PATH}}` entfernt). Betroffen: `cleanup/index.ts` (stylePath/promptVariables weg), `modes.test.ts` (Test auf „keine Stilquellen-Datei" gedreht), `package.json` (`update-style`-Script weg), README + Spec nachgezogen. Entfernt die GPL-Belastung für die Distribution (VSIX/Marketplace — Nutzer wählt Veröffentlichungsweg „Option B"). Tests grün.**

> **Stand: 2026-09-01 · Konto-Nacharbeiten II Web: Modell-Umschalter listet jetzt alle verfügbaren Modelle angemeldeter Provider (WS `model_list`/`model_set`, Filter wie verfuegbareModelle() im IDE-Adapter); Passwort ändern (`POST /auth/password`, andere Sitzungen fliegen) und Konto löschen (`POST /auth/delete` mit Passwort-Bestätigung — räumt Threads samt Session-Dateien, Provider, Credentials und Arbeitsbereich auf) über die Konto-Seite; Senden-Knopf nur noch Icon in Fußleisten-Höhe; 135 Tests grün**

> **Stand: 2026-09-01 · Konto-Nacharbeiten Web: Ursache für „Unbekannter Fehler" und leere Anbieterlisten war ein veralteter Serverprozess auf 4711 (alter Code vor dem Konto-Umbau) — neu gestartet; Onboarding-Seite 5 listet jetzt die drei Anmeldewege explizit mit Knopf zur Konto-Seite; Registrierung mit Passwort-Bestätigung; „anzeigen/verbergen“-Knöpfe an den Passwortfeldern (Login + Registrierung); Fehleranzeige zeigt HTTP-Status statt „Unbekannter Fehler"; Anbieterlisten live geprüft: 39 API-Key- + 7 Browser-Anbieter (wie in der IDE); 131 Tests grün**

> **Stand: 2026-09-01 · Konto-Umbau Web-Version: GitHub-OAuth ersetzt durch Registrierung/Login (Nutzername/E-Mail/Passwort, scrypt); Provider-Anmeldung wie in der IDE mit drei Wegen (API-Key, Browser-OAuth, eigener Endpunkt) pro Konto gemerkt — eigener CredentialStore pro Konto statt globaler auth.json; neue Thread-History mit vollem Fortsetzen (Pi-Session-Dateien) über das ⋯-Menü; „Ohne Konto fortfahren“ bleibt (keine Persistenz); 131 Tests grün, Smoke-Test erweitert**

> **Stand: 2026-09-01 · Web-Oberfläche auf VS-Code-Parität gebracht: Onboarding (5 Seiten), Konto/Provider unabhängig vom Login (Persistenz), Aktionsleiste (Anhang/Kontext-%/Modell/Think/Modus/Senden), Kopfzeile (＋ neuer Thread, ⋯ Menü mit MD-Export), Datei-Upload, Thinking-Stufen, neuer Thread; LRS-Schrift-Umschalter entfernt; 118 Tests grün**

> **Stand: 2026-08-31 · Phase 2d VS-Code-Extension: BYOM-Fehler „Stream ended without finish_reason" behoben (finish_reason-Toleranz), Chat-UX ausgebaut (Arbeits-Animation, einklappbares Denken mit 💡, Kopier-Knöpfe, Nachrichten-Karten); 118 Tests grün, VSIX 0.4.0**

> **Stand: 2026-08-24 · Phase 2d VS-Code-Extension funktionsfähig (eigenes Webview-UI mit Fußleiste, Modi, Export); Wurzel des Webview-Kanal-Bugs behoben; offene Rückmeldungen siehe unten**

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
*   **Repository:** `c:\Users\manue\Desktop\Syntax-Bot`
*   **Quelle der Wahrheit:** `Syntax-Bot-Specification.md` (Architektur und alle Entscheidungen).
*   **Design:** `design/tokens.json` (kanonische Tokens) + `design/STYLE-SOURCE.md` (Herkunft/Lizenzen).
*   **Einstieg für Benutzung:** `README.md`.

**Sofort loslegen:**

```powershell
.\scripts\syntax-bot.ps1          # startet Syntax Bot (richtet beim ersten Mal alles ein)
npm test                          # 135 Tests für Modus-Grenzen, Leitplanken, Web-Jail, Konto/Threads/Auth/BYOM/SSRF, ACP
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
*   **Stilgrundlage für Cleanup:** eigene 7-Punkte-Zusammenfassung etablierter Formatierungsregeln im Prompt (die frühere Kernel-`coding-style.rst` wurde 2026-09-03 entfernt — GPL-2.0, ursprünglich nur als Beispiel gedacht).
*   **Update-Trigger:** bei jedem Start.
*   **Web-Reichweite (neu fixiert, 2026-09-01):** Der Web-Agent ist als **Chat-Interface für die lokale Entwicklung** umgesetzt (Entscheidung: **kein öffentliches Hosting**) — weiterhin **BYOM** („bring your own model"): Jeder Nutzer bringt sein eigenes Modell mit (eigener API-Key oder lokaler Endpunkt, OpenAI-kompatibel: Ollama, LM Studio, llama.cpp). Der Server selbst rechnet nichts ab.
*   **Onboarding & Konto (fixiert, 2026-09-01):** 5-Seiten-Onboarding (Was ist Syntax Bot, Syntax Fix, Code Fix, Cleanup, Modell verbinden) beim ersten Besuch, erneut über das ⋯-Menü (»Hilfe«).
*   **Konto-System (Umbau, 2026-09-01):** GitHub-OAuth ist **ersetzt** durch Registrierung/Login mit Nutzername, E-Mail und Passwort (`POST /auth/register`, `POST /auth/login`, `GET /auth/logout`; scrypt mit Salt pro Konto, `timingSafeEqual`). Konten liegen in `~/.syntax-bot/web-accounts.json`. Registrierung mit Passwort-Bestätigung und „anzeigen/verbergen“-Knöpfen an allen Passwortfeldern. **„Ohne Konto fortfahren“ bleibt** (nur Localhost): dann aber keine Thread-Speicherung und kein Merken von Providern (Wegwerf-Verhalten).
*   **Kontoverwaltung (2026-09-01):** Passwort ändern (`POST /auth/password` — nur mit korrektem altem Passwort, neues Salt, andere Sitzungen werden beendet) und Konto löschen (`POST /auth/delete` — nur mit Passwort-Bestätigung; räumt Threads samt Pi-Session-Dateien, gespeicherte Provider, Credential-Datei und Arbeitsbereich auf). Beides auf der Konto-Seite unter „Dein Konto“.
*   **Modell-Umschalter (2026-09-01):** listet im Chat **alle Modelle aller angemeldeten Provider** (WS `model_list`/`model_set` → `models` mit `{id, provider, aktiv}`; Filter wie `verfuegbareModelle()` im IDE-Adapter — Katalog kommt aus dem SDK, `getProviders()` = 40 Einträge: 39 API-Key, 7 OAuth), danach die gespeicherten eigenen Endpunkte und „Modell konfigurieren …“.
*   **Provider-Drei-Wege wie in der IDE (2026-09-01):** auf der Konto-Seite — 1) API-Key, 2) Browser-Anmeldung (OAuth, Claude Pro/Max & Co.), 3) eigener Endpunkt (BYOM, unverändert). Jede Web-Session bekommt einen **eigenen CredentialStore pro Konto** (`web/server/konto-credentials.ts`, JSON unter `~/.syntax-bot/web-credentials/`, chmod 0600 best-effort; anonym = In-Memory), der dem `ModelRuntime` übergeben wird — dadurch sind **auch OAuth-Tokens pro Konto isoliert** (die zunächst befürchtete „globale auth.json“-Grenze entfällt). `ModelRuntime.login(providerId, art, interaction)` liefert die Rückfragen; `provider_auth_event` reicht `auth_url`/`device_code`/`progress` in den Chat.
*   **Thread-History mit Fortsetzen (2026-09-01):** pro Konto ein Index `~/.syntax-bot/web-threads.json` (`thread-store.ts`); ⋯-Menü »Threads« zeigt die Liste, Klick setzt den Thread mit **vollem Modell-Kontext** fort (`SessionManager.open(sessionDatei)` + `createAgentSession({ sessionManager })` — dasselbe Muster wie `session/load` im IDE-Adapter). Titel = erste Nutzernachricht (60 Zeichen); gespeichert nach jedem Agenten-Zug. Grenze: der Modus-Zustand ist nicht Teil der Session-Datei — fortgesetzte Threads starten im Normalmodus (Hinweis im UI).
*   **Öffentliches Binden:** verlangt jetzt `SYNTAX_BOT_PUBLIC_BIND=1` (ersetzt die frühere OAuth-Bedingung, Warnung auf stderr).
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
    *   **BYOM** (`web/server/byom.ts` + „Modell“-Knopf in der Kopfzeile): Einstellungsdialog mit Endpunkt/API-Key/Modell-ID, Test-Knopf ruft die Modell-Liste ab (OpenAI- und Ollama-Format), Speichern registriert den Provider über `session.modelRuntime.registerProvider(...)` und setzt das Modell. **API-Keys:** ursprünglich nur im Arbeitsspeicher — seit 2026-09-01 (Konto/Persistenz, siehe Phase 2d) pro Konto in `~/.syntax-bot/web-providers.json` persistiert; diese alte Festlegung ist damit überholt.
    *   18 neue Tests (`test/web-auth.test.ts`), Smoke-Test um BYOM-Prüfungen erweitert.
*   [x] **Design-Nacharbeiten (2026-08-23):**
    *   **Token-Generator** (`scripts/generate-tokens.mjs`, `npm run tokens`): erzeugt `web/ui/tokens.css` (Light/Dark-CSS-Variablen) und `design/tokens.ansi.json` (16-Farben-Zuordnung für die spätere CLI) aus `design/tokens.json`. `style.css` enthält keine handgespiegelten Farbwerte mehr.
    *   **Schriften gebündelt:** `web/ui/fonts/` — Doto (Variable, OFL), JetBrains Mono Regular+Bold (v2.304, OFL 1.1). OpenDyslexic Regular (OFL 1.1) war ebenfalls enthalten und wurde **2026-09-01 auf Nutzerwunsch entfernt** (LRS-Schrift-Umschalter komplett raus). Prüfsummen und Herkunft: `design/STYLE-SOURCE.md`.
    *   **OpenDyslexic-Umschalter:** ~~Knopf „LRS-Schrift" in der Web-Kopfzeile~~ — **2026-09-01 entfernt** (Nutzerentscheidung: ungewolltes Feature).
    *   **SSRF-Schutz für BYOM** (`pruefeEndpunkt` in `web/server/byom.ts`): Metadaten-/Link-local-/Reserve-/Multicast-/CGNAT-Adressen sind immer blockiert — auch als DNS-Antwort eines Hostnamens; IPv4-gemappte IPv6-Tricks abgedeckt. Loopback/RFC1918 bleiben erlaubt (lokale Modelle!). `SYNTAX_BOT_BYOM_STRICT=1` blockiert zusätzlich alle privaten Bereiche (für öffentliche Server). 5 neue Tests.
*   [x] **Phase 2c — IDE-Anbindung Zed (2026-08-23):**
    *   **ACP-Adapter** (`ide/index.ts`, `npm run ide`): Syntax Bot spricht den Agent Client Protocol (JSON-RPC 2.0 über stdio) und wird von Zed als External Agent gestartet (`agent_servers` in der settings.json, Anleitung im README).
    *   **Framing** (`ide/acp.ts`): abhängigkeitsfreie ndjson-JSON-RPC-Schicht, in Tests mit gekreuzten Speicher-Verbindungen getrieben.
    *   **Adapter** (`ide/adapter.ts`): pro ACP-Session eine echte Pi-AgentSession (SDK, wie im Web), Arbeitsmappe = Projektordner des Editors; die drei Modi werden als ACP-Modi (`session/set_mode`) und Slash-Commands (`available_commands_update`) angeboten und intern als Pi-Commands ausgeführt — ein einziger Pfad für TUI/Web/IDE.
    *   **UI-Brücke** (`ide/ui-bridge.ts`): `confirm()` des Diff-Guards wird zu `session/request_permission` → nativer Übernehmen/Verwerfen-Dialog in Zed; select/input lehnt die IDE bewusst ab.
    *   10 neue Tests (`test/ide-acp.test.ts`). Bewusst **nicht** `pi-acp` benutzt: dessen Adapter unterstützt keine Extension-Slash-Commands — die Modi wären weggefallen.
*   [x] **Phase 2d — Konto-Umbau Web (2026-09-01):** GitHub-OAuth ersetzt durch Registrierung/Login; drei Anmeldewege pro Konto gemerkt (CredentialStore pro Konto); Thread-History mit Fortsetzen; „Ohne Konto" bleibt wegwerfbar (Details in Abschnitt 1).
    *   **Nacharbeiten (selber Tag)**: Registrierung mit Passwort-Bestätigung (Client-Prüfung) und „anzeigen/verbergen"-Knöpfen an beiden Passwortfeldern; Fehleranzeige mit HTTP-Status statt „Unbekannter Fehler"; Onboarding-Seite 5 nennt die drei Wege als Liste mit Knopf „Alle Wege unter »Konto« öffnen".
    *   **Fehlerbild-Ursache**: Meldungen „Unbekannter Fehler" und leere Anbieter-Dropdowns kamen von einem veralteten Node-Server auf 4711 (gestartet vor dem Umbau). Nach Code-Umbauten am Web-Server den Prozess neu starten — UI-Dateien kommen frisch von der Platte, die Serverlogik nicht.
    *   **Zahlengrundlage Anbieter**: `getProviders()` liefert 40 Katalog-Einträge (39 mit `apiKey`, 7 mit `oauth`) — unabhängig von `models.json`, der Katalog kommt aus dem SDK-Paket.
    *   **Nacharbeiten II (selber Tag)**: Modell-Umschalter zeigt alle Modelle angemeldeter Provider — neue WS-Nachrichten `model_list`/`model_set` (`models`-Antwort mit `{id, provider, aktiv}`), Filter exakt wie `verfuegbareModelle()` im IDE-Adapter; Kontoverwaltung auf der Konto-Seite: Passwort ändern (`POST /auth/password` mit `passwortAlt`/`passwortNeu`, andere Sitzungen werden beendet — `SessionStore.deleteForUser`) und Konto löschen (`POST /auth/delete`, nur mit korrektem Passwort; räumt `ThreadStore.loescheAlle` samt Session-Dateien, `ProviderStore.loescheAlle`, Credential-Datei und Arbeitsbereich auf); Senden-Knopf als reines Icon (`fuss-knopf--senden`), gleiche Höhe wie die übrigen Fußleisten-Knöpfe.
*   [x] Test-Suite: **135 Tests, alle grün** (`npm test`).
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
├── docs/
│   ├── Syntax-Bot-Specification.md ← Quelle der Wahrheit
│   └── HANDOFF.md                  ← diese Datei
├── README.md                     ← Benutzung
├── package.json                  ← Pi-Paket-Manifest, „web"-Skript
├── extensions/
│   ├── core/index.ts             ← Diff-Guard, /modus, /modus-aus, Meta-Werkzeug
│   ├── shared/                   ← geteilter Code, absichtlich ohne index.ts
│   │   ├── mode-core.ts · bash-policy.ts · diff-guard.ts · package-install.ts
│   │   └── prompts/{syntax-fix,code-fix,cleanup}.md
│   ├── syntax-fix/index.ts
│   ├── code-fix/index.ts
│   └── cleanup/index.ts
├── vscode/
│   ├── src/ + media/             ← eigenständige VS-Code-Extension (Webview-Chat, esbuild)
│   ├── web/
│   │   ├── server/               ← index.ts (HTTP+WS+Konto-Endpunkte), session-host.ts, auth.ts,
│   │   │                             accounts.ts, thread-store.ts, konto-credentials.ts,
│   │   │                             byom.ts, provider-store.ts, ui-bridge.ts, jail-extension.ts
│   │   └── ui/                   ← index.html, login.html (+login.js), konto.html, app.js, konto.js,
│   │                                 style.css, tokens.css (Spec-Design, VS-Code-Parität)
│   └── *.vsix                    ← gebaute Extension-Pakete (0.3.0, 0.4.0)
├── ide/                          ← ACP-Adapter (Zed/VS-Code-ACP-Clients)
├── design/                       ← tokens.json, STYLE-SOURCE.md
├── scripts/                      ← bootstrap.mjs, syntax-bot.*, update-pi.*
└── test/                         ← 135 Tests + web-smoke.mjs
```

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
*   [x] Multi-User-Anmeldung: anfangs GitHub-OAuth, **2026-09-01 ersetzt** durch das lokale Konto-System (Nutzername/E-Mail/Passwort, scrypt) — Session-Cookie und Login-Gate bleiben. Öffentliches Binden nur mit `SYNTAX_BOT_PUBLIC_BIND=1`.
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
    *   **„Stream ended without finish_reason" behoben (2026-08-31):** Der Fehler kam aus `pi-ai` (`openai-completions.js`): freie Endpunkte liefern nicht immer ein `finish_reason` im letzten Chunk, und Pi bricht dann hart ab. BYOM-Modelle (`applyByomToSession` in `vscode/web/server/byom.ts`) bekommen jetzt `compat: { supportsFinishReason: false }` — ein fehlendes `finish_reason` wird als „stop"/„toolUse" gedeutet, ein vorhandenes weiterhin normal ausgewertet. Gegen echtes LM Studio (127.0.0.1:1234, `google/gemma-4-e4b`) verifiziert: Endpunkt erreichbar, Stream liefert `reasoning_content`-Deltas. Zusätzlich: **Chat-UX-Ausbau** — (1) Arbeits-Anzeige „Syntax Bot arbeitet …" mit Punkt-Animation während eines Zugs (`prefers-reduced-motion` beachtet); (2) Nutzer-Nachrichten als rechtsbündige Blase, Bot-Antworten als eigene Karte mit Rand; (3) Denk-Block während des Denkens offen lesbar, danach eingeklappt und nur manuell aufklappbar, mit 💡-Icon; (4) Code-Blöcke mit Sprach-Etikett und Kopier-Knopf (Clipboard-API mit `execCommand`-Rückfall). Neue Tests dafür in `test/vscode-webview.test.ts`. Nebenschauplatz: Der `web/`→`vscode/web/`-Umzug war nie committet — Importe in `ide/adapter.ts`, `test/web-auth.test.ts`, `test/web-jail.test.ts` und das `web`-Skript zeigten noch ins Leere und wurden auf `vscode/web/` umgebogen; `test/link-deps.mjs` konnte vorhandene Windows-Junctions nicht ersetzen (EEXIST) — jetzt `unlinkSync` statt `rmSync`. **118 Tests grün**, VSIX 0.4.0 gepackt.
    *   **Web-Oberfläche auf VS-Code-Parität gebracht (2026-09-01):** (1) **Onboarding** mit 5 Seiten (Was ist Syntax Bot, Syntax Fix ●○○, Code Fix ●●○, Cleanup ◐◐◐, Modell verbinden mit Verbindungstest) — beim ersten Besuch automatisch, erneut über ⋯-Menü »Hilfe«; der frühere separate ?-Knopf wurde auf Nutzerwunsch wieder entfernt. (2) **Entscheidung: OAuth-Login unabhängig von Providern** — „Syntax Bot Account“ und Provider-Konfiguration getrennt; neue Konto-Seite (`konto.html`/`konto.js`) mit Provider-Verwaltung, Persistenz pro Konto in `~/.syntax-bot/web-providers.json` (`provider-store.ts`; Plaintext lokal, `chmod 0600` best-effort — bewusste Abkehr von „Keys nur im RAM“ für den Lokal-Betrieb), auto-apply beim Session-Start, »Ohne Provider fortfahren«. (3) **Aktionsleiste unter der Eingabe** wie in der VS-Code-Extension: links ＋ Anhang, rechts Kontext-% (`getContextUsage()`), Modell-Wahl, Thinking-Stufe (`setThinkingLevel`/`getAvailableThinkingLevels`), Modus-Wahl (stille Slash-Commands, ohne Chat-Echo), Senden; alles live über eine neue `session_state`-Nachricht synchronisiert (nach ready, Modell-/Thinking-/Modus-Wechsel und jedem Agenten-Zug). (4) **Kopfzeile:** ＋ für neuen Thread (Session wird verworfen und neu geöffnet, zweites `ready`), ⋯-Menü mit Thread-Export als Markdown, Hilfe und Anmelden — **bewusst ohne Einstellungen** (doppelt sich mit dem Konto-Knopf). (5) **Datei-Anhänge:** Base64-Upload (max. 10 MB) in den Workspace-Ordner `uploads/`, Namen bereinigt, Pfad wird in die Nachricht eingefügt. (6) **LRS-Schrift-Umschalter komplett entfernt** (Knopf, `body.schrift-lrs`, OpenDyslexic-Datei) — Nutzerentscheidung. (7) Fallstrick behoben: Autoren-`display:flex` auf `.dialog-overlay` überschreibt das UA-`[hidden]` → Overlays blieben sichtbar; global `[hidden] { display: none !important }`. Smoke-Test erweitert (Anmeldeseite + /app, Aktionsleiste, LRS-frei). 118 Tests grün.
    *   **Konto-Umbau der Web-Version (2026-09-01):** (1) **Konto-System:** GitHub-OAuth komplett entfernt; Registrierung/Login mit Nutzername/E-Mail/Passwort (`accounts.ts`: scrypt mit Salt pro Konto, `timingSafeEqual`; `auth.ts` hält Session-/Cookie-/Rate-Limit-Helfer). Anmeldeformular mit Umschalter »Anmelden/Registrieren« (`login.html`/`login.js`); »Ohne Konto fortfahren« bleibt für den Localhost-Betrieb — dann ohne Thread- und Provider-Persistenz. Workspace-Kennung unverändert `nutzer-<id>`, Provider-Zuordnung jetzt `konto-<id>` (`provider-store.ts`, Feld `art: custom|api|oauth`; fehlendes Feld = `custom`). (2) **Provider-Drei-Wege wie in der IDE** auf der Konto-Seite: API-Key und Browser-Anmeldung laufen über `modelRuntime.login(providerId, art, interaction)` — `interaction.prompt` antwortet automatisch mit dem eingegebenen Key (bzw. fragt über die UI-Bridge nach), `notify` wird als WS-Nachricht `provider_auth_event` in den Chat gereicht (auth_url/device_code/progress). **Entscheidender Fund:** `ModelRuntime.create({ credentials })` akzeptiert einen eigenen CredentialStore — mit `konto-credentials.ts` (JSON pro Konto, serialisierte Schreibsperren, In-Memory für Anonyme) sind **auch OAuth-Tokens pro Konto isoliert**; die globale `auth.json` wird für Web-Sessions nicht mehr benutzt. (3) **Thread-History mit Fortsetzen** (Nutzerwahl „B“): `thread-store.ts` pflegt pro Konto den Index; `session-host.ts` öffnet fortzusetzende Threads über `SessionManager.open(sessionDatei)` + `createAgentSession({ sessionManager, modelRuntime })` (Muster des IDE-Adapters), sendet den bisherigen Verlauf als `thread_history` und speichert nach jedem Agenten-Zug (Titel = erste Nutzernachricht). Fehlerhafte/fehlende Session-Datei → Warnung + frischer Thread. ⋯-Menü-Eintrag »Threads« mit Overlay (Titel/Datum/Löschen, aktiver Thread markiert). Neue WS-Nachrichten: `thread_list`/`thread_open`/`thread_delete`, `threads`, `thread_history`, `provider_status`/`provider_login`/`provider_logout`, `provider_auth_event`; `ready` trägt jetzt auch `email` und `threadId`. (4) `index.ts`: `POST /auth/register` (10/min/IP), `POST /auth/login` (20/min/IP, gleiche Fehlermeldung für unbekannt/falsch gegen Konto-Enumeration), `GET /auth/logout`; öffentliches Binden nur mit `SYNTAX_BOT_PUBLIC_BIND=1` (ersetzt die OAuth-Bedingung). Tests: KontoStore/scrypt, Thread-Store, Credential-Store (Datei/In-Memory/Sperren), `webAuthConfigFromEnv` — GitHub-Tests entfernt; Smoke-Test um Registrierung/Login/Logout, Threads-Overlay und `thread_list`/`thread_open`-Fluss erweitert. **131 Tests grün.** Grenze: Der Modus-Zustand der Extensions ist nicht Teil der Pi-Session-Datei — fortgesetzte Threads starten im Normalmodus.
    *   **Konto-Nacharbeiten (2026-09-01, zwei Runden):** (I) Registrierung mit Passwort-Bestätigung + „anzeigen/verbergen“-Knöpfen, Onboarding-Seite 5 mit den drei Anmeldewegen als Liste + Knopf zur Konto-Seite, Fehleranzeige mit HTTP-Status; Ursache für „Unbekannter Fehler"/leere Anbieterlisten war ein veralteter Serverprozess (Serverlogik lebt im RAM, UI kommt frisch von der Platte — nach Umbauten neu starten). (II) Modell-Umschalter mit allen Modellen angemeldeter Provider (`model_list`/`model_set`), Kontoverwaltung (Passwort ändern `POST /auth/password`, Konto löschen `POST /auth/delete` mit vollständiger Datenbereinigung), Senden-Knopf als reines Icon. **135 Tests grün.**
*   [ ] Manuelle Erprobung der Extension in VS Code (VSIX bauen, installieren, Chat/Diff/Modi durchspielen) und Verpackungsdetails (Publisher-ID für den Marketplace).

### Phase 3: Ökosystem & Stabilität
*   [ ] Kompatibilität mit allen Pi-Skills und -Templates prüfen.
*   [ ] Test-Suite gegen ein echtes Modell (heute Stub — prüft Grenzen, nicht Prompt-Qualität).
*   [ ] Formale Prüfung der Cleanup-Logik-Invarianz (AST-Vergleich).
*   [ ] Auto-Update optimieren (tägliche Hintergrundprüfung statt bei jedem Start).

---

## 5. Offene Punkte (Entscheidungsbedarf)

1.  **Lizenz und Repo-Sichtbarkeit.** ~~Die mitgelieferte Kernel-Stilquelle steht unter GPL-2.0.~~ **Entschärft (2026-09-03):** Die GPL-2.0-`coding-style.rst` ist entfernt; der Cleanup-Modus nutzt eine eigene Stilzusammenfassung im Prompt (Alternative (c)). Damit hängt keine GPL-Belastung mehr an der Distribution (VSIX/Marketplace). Offen bleibt die grundsätzliche Lizenzwahl für den Rest des Repos.
2.  **UI-Sprache.** Vorläufig gesetzt: Modus-Commands englisch (`/syntax-fix`, spec-fixiert), Kern-Commands und Texte deutsch, der Agent antwortet in der Sprache des Nutzers. Für eine Veröffentlichung wäre Englisch als Grundsprache mit deutscher Übersetzung der sauberere Weg.
3.  **Web-Betrieb:** Die Konto-/Provider-/Thread-Umsetzung ist auf localhost automatisch geprüft (Unit + Smoke); der Browser-OAuth-Durchlauf eines echten Anbieters (Claude Pro/Max o. ä.) braucht ein echtes Abo und ist manuell zu testen. Umgebungsvariablen: `SYNTAX_BOT_PUBLIC_BIND=1` (Binden ins Netz), `SYNTAX_BOT_SECURE=1` (Cookie mit Secure, hinter HTTPS-Proxy), `SYNTAX_BOT_TRUST_PROXY=1` (X-Forwarded-For auswerten), `SYNTAX_BOT_MAX_SESSIONS` (parallele WS je Nutzer).
4.  ~~Design-Assets vervollständigen~~ — **erledigt (2026-08-23):** Schriften liegen unter `web/ui/fonts/` (Prüfsummen in `design/STYLE-SOURCE.md`), der Token-Generator läuft per `npm run tokens`. OpenDyslexic-Umschaltung war eingebaut und wurde 2026-09-01 auf Nutzerwunsch wieder entfernt. Offen bleibt nur die Icon-Satz-Wahl (Lucide vs. Phosphor) — aktuell braucht die UI keine Icons.
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
*   **Key-Persistenz (geändert 2026-09-01):** BYOM-/Provider-Konfiguration wird pro Konto in `~/.syntax-bot/web-providers.json` persistiert (Plaintext, `chmod 0600` best-effort) — Entscheidung des Nutzers für den Komfort beim lokalen Betrieb. **Native Provider-Anmeldungen** (API-Keys UND OAuth-Tokens) liegen zusätzlich pro Konto in `~/.syntax-bot/web-credentials/` (ebenfalls Plaintext-JSON, chmod 0600 best-effort) — beides wäre für einen **öffentlichen** Server wieder zu entfernen bzw. zu verschlüsseln. Konten (`web-accounts.json`) enthalten nur scrypt-Hashes, keine Klartext-Passwörter.
