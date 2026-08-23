# Syntax Bot — Projektübergabe (HANDOFF)

**Stand: 2026-08-23 · Version 0.2.1 · Phase 2b abgeschlossen + Design-Nacharbeiten (Token-Generator, Schriften, OpenDyslexic, BYOM-SSRF-Schutz)**

> **📌 Dauerregeln des Nutzers — gelten immer, ohne Nachfragen:**
>
> 1. **Antwort-Stil:** Erledigtes **sehr kurz und stichpunktartig** melden. **Ausführlich nur bei offenen Fragen und Entscheidungen**, die der Nutzer treffen muss — die für diese klar begründet werden.
> 2. **Sprache:** durchgehend Deutsch — UI (wenn relevant), Kommentare, Commits, diese Datei.
> 3. **Änderungen:** Änderungen am Code werden immer mit einer **Diff-Vorschau** (via Agent) vorgeschlagen. Der Agent schreibt nie ungefragt in Dateien.
> 4. **Sicherheit:** Vor jeder Installation von Pi-Paketen (via Meta-Tool) muss eine explizite Bestätigung des Nutzers eingeholt werden.

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
*   [ ] Nächster Schritt: **Phase 2d (VS Code)** — VS Code hat kein natives ACP; Community-Extension (`vscode-acp`) evaluieren oder eigenes Bridge-Panel bauen.
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

### Phase 2d: IDE-Anbindung VS Code — **offen**
*   [ ] VS Code hat kein natives ACP — Community-Extension (`vscode-acp`) evaluieren oder eigenes Bridge-Panel bauen.

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
