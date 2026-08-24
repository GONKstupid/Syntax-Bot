/**
 * ACP-Adapter — Syntax Bot als External Agent für Zed (& Co.).
 *
 * Zed startet dieses Programm als Unterprozess und spricht ACP
 * (JSON-RPC 2.0 über stdio) mit ihm. Pro ACP-Session wird eine echte
 * Pi-AgentSession der isolierten Instanz erzeugt — mit allen Extensions,
 * also auch den drei Modi und dem Diff-Guard. Die Arbeitsmappe ist das
 * Projektverzeichnis des Editors; ein Jail ist lokal nicht nötig, die
 * Modus-Politiken greifen unverändert.
 *
 * Umsetzungshinweis: Die drei Modi sind Slash-Commands — genau dafür hat ACP
 * `availableCommands` (Vorschlagsliste) und `set_mode` (Modus-Umschalter im
 * Panel). Beide führen auf denselben Weg: den Command-Text an Pi durchreichen.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AcpVerbindung, RpcNotification, RpcRequest } from "./acp.ts";
import { IdeUiBridge } from "./ui-bridge.ts";
import { applyByomToSession, fetchRemoteModels, validateByomConfig } from "../web/server/byom.ts";

/** Die Modi als ACP-Modi — Reihenfolge wie in der Spec-Tabelle. */
export const MODI = [
	{ id: "default", name: "Kein Modus", beschreibung: "Syntax Bot ohne Modus-Einschränkung" },
	{ id: "syntax-fix", name: "Syntax Fix", beschreibung: "Nur Rechtschreibung und Syntax" },
	{ id: "code-fix", name: "Code Fix", beschreibung: "Syntax, Struktur und Fehlerreduktion" },
	{ id: "cleanup", name: "Cleanup", beschreibung: "Nur Struktur und Formatierung, keine Logik" },
] as const;

/**
 * Der Command-Katalog für das „/“-Popup des Editors. Wichtig: ACP will die
 * Namen ohne führenden Schrägstrich — der Client schickt beim Ausführen selbst
 * wieder „/name …“ als Prompt-Text.
 *
 * modus:
 *   "ide"    — wird vom Adapter nativ ausgeführt (SDK-Aufrufe oder Anleitung)
 *   "pi"     — wird unverändert an die Extensions durchgereicht
 *   "tui"    — existiert nur im Terminal-TUI von Pi; der Adapter erklärt das
 */
export const KOMMANDOS: Array<{ name: string; description: string; hint?: string; modus: "ide" | "pi" | "tui" }> = [
	{ name: "syntax-fix", description: "Nur Rechtschreibung und Syntax korrigieren", hint: "Welcher Code?", modus: "pi" },
	{ name: "code-fix", description: "Syntax, Struktur und Fehler reduzieren", hint: "Welcher Code?", modus: "pi" },
	{ name: "cleanup", description: "Nur Struktur und Formatierung bereinigen", hint: "Welcher Code?", modus: "pi" },
	{ name: "modus", description: "Aktuellen Modus anzeigen", modus: "pi" },
	{ name: "modus-aus", description: "Modus beenden", modus: "pi" },
	{ name: "model", description: "Modelle auflisten oder wechseln", hint: "leer = Liste, sonst Modell-ID", modus: "ide" },
	{ name: "login", description: "Anmelden — geführt im Chat (API-Key, Browser oder eigener Endpunkt)", modus: "ide" },
	{ name: "logout", description: "Provider abmelden", hint: "<provider>", modus: "ide" },
	{ name: "new", description: "Neue Session beginnen", modus: "ide" },
	{ name: "compact", description: "Verlauf zusammenfassen, um Kontext zu sparen", hint: "optionale Anweisung", modus: "ide" },
	{ name: "tools", description: "Aktive Werkzeuge anzeigen", modus: "ide" },
	{ name: "stats", description: "Kontext- und Sitzungsstatistik anzeigen", modus: "ide" },
	{ name: "reload", description: "Extensions und Konfiguration neu laden", modus: "ide" },
	{ name: "settings", description: "Einstellungen direkt im Chat ändern", modus: "ide" },
	{ name: "help", description: "Übersicht der Commands", modus: "ide" },
	{ name: "resume", description: "Frühere Session fortsetzen", modus: "tui" },
	{ name: "tree", description: "Im Session-Baum navigieren", modus: "tui" },
	{ name: "share", description: "Session als Link hochladen", modus: "tui" },
	{ name: "theme", description: "Farbschema wählen", modus: "tui" },
];

const ANLEITUNG_LOGIN =
	"Kein Problem — hier die direkten Wege:\n" +
	"- **1** oder `/login api` — API-Key (Anthropic, OpenAI, …)\n" +
	"- **2** oder `/login browser` — Anmeldung im Browser (Claude Pro/Max, ChatGPT-Plus …)\n" +
	"- **3** oder `/login custom` — eigener Endpunkt (Ollama, LM Studio, llama.cpp …)";

const ANLEITUNG_EINSTELLUNGEN =
	"Einstellungen liegen in der isolierten Instanz:\n" +
	"- `~/.syntax-bot/agent/settings.json` — Einstellungen\n" +
	"- `~/.syntax-bot/agent/models.json` — eigene Modelle/Provider\n" +
	"- `~/.syntax-bot/agent/auth.json` — Anmeldedaten (durch Login befüllt)";

const TUI_HINWEIS = (name: string) =>
	`/${name} gibt es nur im Terminal-TUI von Pi (scripts\\syntax-bot.cmd). ` +
	"In der IDE ist es bewusst nicht eingebaut — wenn du es brauchst, sag Bescheid.";

/** Textanteil einer Assistenten-Nachricht (wie in web/server/session-host.ts). */
function extractText(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text")
		.map((block) => block.text)
		.join("");
}

export interface AdapterOptionen {
	agentDir: string;
	/** Ablage der ACP→Pi-Sessions-Mapping (Standard: <agentDir>-Elternverzeichnis). */
	speicherPfad?: string;
	/** Nur für Tests: Session-Erzeugung austauschen. */
	sessionErzeugen?: typeof standardSessionErzeugen;
}

async function standardSessionErzeugen(
	cwd: string,
	agentDir: string,
	sessionFile?: string,
): Promise<AgentSession> {
	const loader = new DefaultResourceLoader({ cwd, agentDir });
	await loader.reload();
	const sessionManager = sessionFile ? SessionManager.open(sessionFile, undefined, cwd) : undefined;
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader: loader,
		sessionManager,
	});
	return session;
}

export class AcpAdapter {
	private readonly sessions = new Map<string, IdeAcpSession>();
	private readonly optionen: AdapterOptionen;

	constructor(optionen: AdapterOptionen) {
		this.optionen = optionen;
	}

	/** Mapping ACP-Session → Pi-Session-Datei (für session/load). */
	private get mappingDatei(): string {
		return this.optionen.speicherPfad ?? join(dirname(this.optionen.agentDir), "ide-sessions.json");
	}

	private leseMapping(): Record<string, string> {
		try {
			if (!existsSync(this.mappingDatei)) return {};
			return JSON.parse(readFileSync(this.mappingDatei, "utf8")) as Record<string, string>;
		} catch {
			return {};
		}
	}

	private schreibeMapping(mapping: Record<string, string>): void {
		try {
			writeFileSync(this.mappingDatei, JSON.stringify(mapping, null, "\t") + "\n");
		} catch {
			// Ohne Schreibrecht läuft die Session eben ohne Wiederherstellung.
		}
	}

	async anfrage(verbindung: AcpVerbindung, anfrage: RpcRequest): Promise<unknown> {
		const params = (anfrage.params ?? {}) as Record<string, unknown>;
		switch (anfrage.method) {
			case "initialize": {
				const gewuenscht = typeof params.protocolVersion === "number" ? params.protocolVersion : 1;
				return {
					protocolVersion: gewuenscht,
					agentCapabilities: {
						loadSession: true,
						promptCapabilities: {},
					},
					authMethods: [],
					_meta: { agentName: "Syntax Bot", version: "0.3.0" },
				};
			}
			case "session/new":
			case "session/load": {
				const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
				const sessionId = anfrage.method === "session/load" ? String(params.sessionId ?? "") : randomUUID();

				// Bei load: die Pi-Session-Datei aus dem Mapping wiederherstellen.
				let sessionFile: string | undefined;
				if (anfrage.method === "session/load") {
					sessionFile = this.leseMapping()[sessionId];
					if (!sessionFile || !existsSync(sessionFile)) {
						throw new Error(`Session „${sessionId}“ ist nicht bekannt oder ihre Datei fehlt.`);
					}
				}

				const bridge = new IdeUiBridge(verbindung, sessionId);
				let pi: AgentSession;
				try {
					pi = await (this.optionen.sessionErzeugen ?? standardSessionErzeugen)(cwd, this.optionen.agentDir, sessionFile);
				} catch (fehler) {
					throw new Error(
						`Pi-Session konnte nicht gestartet werden (${fehler instanceof Error ? fehler.message : String(fehler)}). ` +
							"Bitte einmal „scripts/syntax-bot.ps1“ bzw. „scripts/syntax-bot.sh“ ausführen.",
					);
				}
				const gehostet = new IdeAcpSession(sessionId, cwd, pi, bridge, verbindung);
				this.sessions.set(sessionId, gehostet);

				// Mapping für spätere session/load-Aufrufe pflegen.
				const piDatei = pi.sessionFile;
				if (piDatei) {
					const mapping = this.leseMapping();
					mapping[sessionId] = piDatei;
					this.schreibeMapping(mapping);
				}

				if (!pi.model) {
					gehostet.nachricht(
						"Es ist noch kein Modell eingerichtet. Tippe /login — API-Key oder eigener Endpunkt, alles direkt hier im Chat.",
					);
				}

				return {
					sessionId,
					modes: {
						currentModeId: "default",
						availableModes: MODI.map((modus) => ({
							id: modus.id,
							name: modus.name,
							description: modus.beschreibung,
						})),
					},
					_meta: { workspace: cwd },
				};
			}
			case "session/set_mode": {
				const gehostet = this.sessions.get(String(params.sessionId));
				if (!gehostet) throw new Error("Unbekannte Session.");
				await gehostet.setMode(String(params.modeId));
				return {};
			}
			case "session/prompt": {
				const gehostet = this.sessions.get(String(params.sessionId));
				if (!gehostet) throw new Error("Unbekannte Session.");
				return await gehostet.prompt(params.prompt);
			}
			case "session/status": {
				const gehostet = this.sessions.get(String(params.sessionId));
				if (!gehostet) throw new Error("Unbekannte Session.");
				return await gehostet.status();
			}
			case "session/set_model": {
				const gehostet = this.sessions.get(String(params.sessionId));
				if (!gehostet) throw new Error("Unbekannte Session.");
				await gehostet.modellSetzen(String(params.modelId ?? ""));
				return {};
			}
			case "session/set_thinking": {
				const gehostet = this.sessions.get(String(params.sessionId));
				if (!gehostet) throw new Error("Unbekannte Session.");
				gehostet.thinkingSetzen(String(params.level ?? ""));
				return {};
			}
			default:
				throw new Error(`Methode nicht unterstützt: ${anfrage.method}`);
		}
	}

	benachrichtigung(nachricht: RpcNotification): void {
		if (nachricht.method !== "session/cancel") return;
		const sessionId = (nachricht.params as { sessionId?: string } | undefined)?.sessionId;
		if (!sessionId) return;
		this.sessions.get(sessionId)?.abbrechen();
	}

	schliessen(): void {
		for (const gehostet of this.sessions.values()) gehostet.dispose();
		this.sessions.clear();
	}
}

/**
 * ACP-Inhaltsblock → Prompt-Text. Textblöcke bleiben, wie sie sind;
 * Datei-Verweise aus dem Editor („@datei.ts" in Zed) kommen als
 * resource_link an und werden in eine Pi-taugliche Pfadangabe übersetzt.
 */
function blockZuText(block: unknown): string {
	if (typeof block !== "object" || block === null) return "";
	const b = block as { type?: string; text?: string; uri?: string; name?: string };
	if (b.type === "text" && typeof b.text === "string") return b.text;
	if (b.type === "resource_link") {
		const dekodiert = decodeURIComponent(b.uri ?? "");
		const pfad = dekodiert.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
		return `@${pfad}`;
	}
	if (b.type === "resource") {
		return "";
	}
	return typeof b.text === "string" ? b.text : "";
}

export class IdeAcpSession {
	private readonly unsubscribe: () => void;
	readonly id: string;
	readonly cwd: string;
	private readonly pi: AgentSession;
	private readonly bridge: IdeUiBridge;
	private readonly verbindung: AcpVerbindung;
	/** Resolver einer offenen Chat-Rückfrage (/login-Fluss). */
	private frageOffen?: (antwort: string) => void;
	/** Bereits beantwortete Chat-Fragen — Provider-Nachfragen bedienen sich daraus. */
	private antwortPuffer: string[] = [];
	/** Länge des Assistententextes, der bereits als Chunk gesendet wurde. */
	private gesendet = 0;
	/** Länge des Denk-Protokolls, das bereits als Chunk gesendet wurde. */
	private denkGesendet = 0;
	/** Zuletzt bekannt gegebener Modus (für current_mode_update). */
	private aktuellerModusId = "default";
	/** Ob der laufende Zug mindestens eine Antwortzeile gebracht hat. */
	private hatGeantwortet = false;

	constructor(
		id: string,
		cwd: string,
		pi: AgentSession,
		bridge: IdeUiBridge,
		verbindung: AcpVerbindung,
	) {
		this.id = id;
		this.cwd = cwd;
		this.pi = pi;
		this.bridge = bridge;
		this.verbindung = verbindung;
		this.unsubscribe = pi.subscribe((ereignis) => this.weiterleiten(ereignis));
		// Bewusst als Macrotask: Die Benachrichtigung muss NACH der Antwort auf
		// session/new beim Editor ankommen — manche Clients verwerfen Updates,
		// die vor der fertigen Antwort hereinkommen.
		setTimeout(() => {
			this.kommandosBekanntgeben();
			if (!pi.model) {
				this.nachricht("Es ist noch kein Modell eingerichtet — tippe /login, das geht direkt hier im Chat.");
			}
		}, 0);
	}

	private sendeUpdate(update: Record<string, unknown>): void {
		this.verbindung.benachrichtigen("session/update", { sessionId: this.id, update });
	}

	/** Freie Textnachricht in den Chat (Hinweise, Fehler). */
	nachricht(text: string): void {
		this.sendeUpdate({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: `${text}\n` },
		});
	}

	private kommandosBekanntgeben(): void {
		this.sendeUpdate({
			sessionUpdate: "available_commands_update",
			availableCommands: KOMMANDOS.map((kommando) => ({
				name: kommando.name,
				description: kommando.description,
			})),
		});
	}

	async setMode(modeId: string): Promise<void> {
		const modus = MODI.find((kandidat) => kandidat.id === modeId);
		if (!modus) throw new Error(`Unbekannter Modus: ${modeId}`);
		this.aktuellerModusId = modeId;
		// Die Extensions sind Commands — der Weg über den Command-Text hält
		// alles in einem Pfad (TUI, Web und IDE verhalten sich identisch).
		const ziel = modeId === "default" ? "/modus-aus" : `/${modeId}`;
		void this.pi.prompt(ziel).catch(() => {});
		this.sendeUpdate({
			sessionUpdate: "current_mode_update",
			currentModeId: modeId,
		});
	}

	/**
	 * Nach einem Modus-Command per Slash-Text die Clients auf den neuen Stand
	 * bringen — sonst zeigt z. B. die VS-Code-Fußleiste den alten Modus.
	 */
	private modusNachmelden(name: string, vorher?: string): void {
		const ziels: Record<string, string> = {
			"syntax-fix": "syntax-fix",
			"code-fix": "code-fix",
			cleanup: "cleanup",
			"modus-aus": "default",
		};
		const id = ziels[name];
		if (!id || id === vorher) return;
		this.aktuellerModusId = id;
		this.sendeUpdate({
			sessionUpdate: "current_mode_update",
			currentModeId: id,
		});
	}

	/** Benachrichtigt angemeldete Clients, dass sich Provider/Modell geändert haben. */
	private aktualisieren(): void {
		this.verbindung.benachrichtigen("syntax-bot/refresh", { sessionId: this.id });
	}


	async prompt(inhalt: unknown): Promise<{ stopReason: string }> {
		const bloecke = Array.isArray(inhalt) ? inhalt : [];
		const teile = bloecke.map(blockZuText).filter((teil): teil is string => teil.length > 0);
		const text = teile.join("\n").trim();
		// Bewusst KEIN early-return bei leerem Text: Eine leere Eingabe ist die
		// gültige Antwort auf Chat-Rückfragen („Key nicht nötig — Enter").
		// Läuft gerade eine Chat-Rückfrage (z. B. API-Key eingeben)? Dann ist
		// diese Nachricht die Antwort — auch eine LEERE (manche Provider
		// brauchen keinen Key). Aber NUR Klartext: Slash-Commands brechen die
		// offene Rückfrage kontrolliert ab und werden ausgeführt (sonst würde
		// /settings vom hängenden Login-Dialog verschluckt).
		if (this.frageOffen) {
			const auflösen = this.frageOffen;
			this.frageOffen = undefined;
			if (!text.startsWith("/")) {
				this.antwortPuffer.push(text);
				auflösen(text);
				return { stopReason: "end_turn" };
			}
			auflösen("");
			this.nachricht("*(Offene Eingabe abgebrochen.)*");
		}
		if (!text || text === "-") return { stopReason: "end_turn" };
		// „-" ist die Bestätigung für „leer" bei Chat-Rückfragen (z. B. kein
		// API-Key nötig) — ohne offene Frage ist es ein No-op.

		if (text.startsWith("/")) {
			return await this.command(text);
		}

		try {
			// Ohne Modell gar erst versuchen — die rohe Provider-Fehlermeldung
			// hilft nicht weiter; der /login-Hinweis schon.
			const pi = this.pi as unknown as { model?: unknown };
			if (!pi.model) {
				this.nachricht(
					"Es ist noch kein Modell eingerichtet. Tippe **/login** — API-Key, Browser-Anmeldung oder eigener Endpunkt (Ollama & Co.), geführt im Chat.",
				);
				return { stopReason: "end_turn" };
			}
			this.hatGeantwortet = false;
			await this.pi.prompt(text);
			if (!this.hatGeantwortet) {
				this.nachricht(
					"*(Der Modellaufruf lief ohne sichtbare Antwort durch — bitte Provider/Modell prüfen oder erneut senden.)*",
				);
			}
			return { stopReason: "end_turn" };
		} catch (fehler) {
			this.fehlermeldung(fehler);
			return { stopReason: "end_turn" };
		}
	}

	/** Zentrale Command-Weiterleitung nach dem Katalog (KOMMANDOS). */
	private async command(text: string): Promise<{ stopReason: string }> {
		const [rohName, ...rest] = text.slice(1).split(/\s+/);
		// Groß-/Kleinschreibung ignorieren — „/Login“ ist „/login“.
		const name = rohName.toLowerCase();
		const argument = rest.join(" ").trim();
		const eintrag = KOMMANDOS.find((kandidat) => kandidat.name === name);

		// Unbekannter Slash-Command → trotzdem an Pi (Extensions könnten ihn kennen).
		if (!eintrag || eintrag.modus === "pi") {
			try {
				const vorModus = this.aktuellerModusId;
				await this.pi.prompt(`/${name}${argument ? ` ${argument}` : ""}`);
				this.modusNachmelden(name, vorModus);
				return { stopReason: "end_turn" };
			} catch (fehler) {
				this.fehlermeldung(fehler);
				return { stopReason: "end_turn" };
			}
		}
		if (eintrag.modus === "tui") {
			this.nachricht(TUI_HINWEIS(name));
			return { stopReason: "end_turn" };
		}

		switch (name) {
			case "model":
				await this.modellKommando(argument);
				break;
			case "login":
				// Bewusst ohne await: Der Fluss stellt Fragen im Chat und wird
				// mit der nächsten Nutzernachricht fortgesetzt — die Antwort auf
				// diesen Prompt darf darauf nicht warten (Deadlock im Editor).
				void this.loginKommando(argument).catch(() => {});
				break;
			case "logout":
				await this.logoutKommando(argument);
				break;
			case "new":
				this.pi.sessionManager.newSession();
				this.nachricht("Neue Session begonnen.");
				break;
			case "compact": {
				const ergebnis = await this.pi.compact(argument || undefined);
				this.nachricht(`Verlauf kompakt: ${ergebnis.summary ?? "erledigt"}`);
				break;
			}
			case "tools": {
				const werkzeuge = this.pi.getActiveToolNames();
				this.nachricht(`Aktive Werkzeuge (${werkzeuge.length}):\n${werkzeuge.map((w) => `- ${w}`).join("\n")}`);
				break;
			}
			case "stats": {
				const kontext = this.pi.getContextUsage();
				if (!kontext || kontext.tokens === null) {
					this.nachricht("Noch keine Kontextdaten — schreibe zuerst eine Nachricht.");
					break;
				}
				const prozent = Math.round(kontext.percent ?? 0);
				this.nachricht(`Kontext: ${kontext.tokens} von ${kontext.contextWindow} Tokens (${prozent} %)`);
				break;
			}
			case "reload":
				await this.pi.reload();
				this.nachricht("Extensions und Konfiguration neu geladen.");
				break;
			case "settings":
				// Detached wie /login: Der Dialog stellt Fragen, deren Antworten
				// als eigene Nachrichten kommen — die Antwort hier darf nicht warten.
				void this.einstellungenKommando().catch(() => {});
				break;
			case "help": {
				const liste = KOMMANDOS.map((k) => `/${k.name}${k.modus === "tui" ? " *(nur Terminal)*" : ""} — ${k.description}`).join("\n");
				this.nachricht(`**Commands:**\n${liste}`);
				break;
			}
			default:
				this.nachricht(TUI_HINWEIS(name));
		}
		return { stopReason: "end_turn" };
	}

	/**
	 * /login — geführter Dialog, alles direkt im Chat:
	 *   /login                fragt: API-Key, Browser-Anmeldung oder eigener Endpunkt?
	 *   /login api            → Provider wählen, Key abfragen, speichern
	 *   /login browser        → OAuth/Subscription (Claude Pro & Co.) mit Link im Chat
	 *   /login custom         → eigener OpenAI-kompatibler Endpunkt (BYOM)
	 * Abkürzungen wie „/login api anthropic“ funktionieren ebenfalls.
	 */
	private async loginKommando(argument: string): Promise<void> {
		const teile = argument.split(/\s+/).filter(Boolean);
		const art = (teile[0] ?? "").toLowerCase();
		const direktProvider = teile[1];

		try {
			if (art === "custom" || art === "endpunkt" || art === "3") {
				await this.customLogin();
				return;
			}
			if (art === "api" || art === "key" || art === "1") {
				const provider = await this.providerWählen("api", direktProvider);
				if (!provider) return;
				const schluessel = (await this.frage(`API-Key für ${provider.name}:`)).trim();
				if (!schluessel) {
					this.nachricht("Abgebrochen — ohne Key geht es nicht weiter.");
					return;
				}
				await this.pi.modelRuntime.login(provider.id, "api_key", this.interaktion());
				await this.modellDesProvidersAktivieren(provider.id);
				this.nachricht(`${provider.name} ist angemeldet.`);
				this.aktualisieren();
				return;
			}
			if (art === "browser" || art === "oauth" || art === "2") {
				const provider = await this.providerWählen("oauth", direktProvider);
				if (!provider) return;
				this.nachricht(
					`Browser-Anmeldung für ${provider.name} wird gestartet — der Link erscheint gleich hier. ` +
						"Fertiggestellt wird automatisch, sobald du im Browser bestätigt hast.",
				);
				await this.pi.modelRuntime.login(provider.id, "oauth", this.interaktion());
				await this.modellDesProvidersAktivieren(provider.id);
				this.nachricht(`${provider.name} ist angemeldet.`);
				this.aktualisieren();
				return;
			}

			// Geführter Einstieg.
			this.nachricht(
				"Wie möchtest du dich anmelden? Antworte einfach im Chat:\n" +
					"**1** — API-Key (Anthropic, OpenAI, …)\n" +
					"**2** — Anmeldung im Browser (Claude Pro/Max, ChatGPT-Plus, …)\n" +
					"**3** — Eigener Endpunkt (Ollama, LM Studio, llama.cpp …)",
			);
			const wahl = (await this.frage("Deine Wahl (1, 2 oder 3):")).trim();
			await this.loginKommando(wahl);
		} catch (fehler) {
			this.nachricht(
				`Anmeldung nicht abgeschlossen: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
			);
		}
	}

	private interaktion() {
		return {
			prompt: async (nachfrage: { type?: string; message?: string }) => {
				// Die Frage wurde oft schon im Chat gestellt — Puffer zuerst.
				const gepuffert = this.antwortPuffer.shift();
				if (gepuffert !== undefined) return gepuffert.trim();
				return (await this.frage(nachfrage.message ?? "Bitte eingeben:")).trim();
			},
			notify: (ereignis: Record<string, unknown>) => {
				switch (ereignis.type) {
					case "info":
						this.nachricht(String(ereignis.message ?? ""));
						break;
					case "auth_url":
						this.nachricht(
							`🔐 Bitte diesen Link öffnen und dort anmelden:\n${String(ereignis.url)}\n` +
								(ereignis.instructions ? `\n${String(ereignis.instructions)}` : ""),
						);
						break;
					case "device_code":
						this.nachricht(
							`🔐 Öffne ${String(ereignis.verificationUri)} und gib dort diesen Code ein:\n**${String(ereignis.userCode)}**`,
						);
						break;
					case "progress":
						this.nachricht(String(ereignis.message ?? "…"));
						break;
					default:
						this.nachricht(JSON.stringify(ereignis));
				}
			},
		};
	}

	/** Nummerierte Provider-Auswahl im Chat; Antwort per Ziffer oder Name. */
	private async providerWählen(
		art: "api" | "oauth",
		vorgegeben?: string,
	): Promise<{ id: string; name: string } | undefined> {
		const authSchluessel = art === "api" ? "apiKey" : "oauth";
		const alle = this.pi.modelRuntime.getProviders().filter((p) => {
			const auth = (p as { auth?: Record<string, unknown> }).auth ?? {};
			return Boolean(auth[authSchluessel]);
		});
		if (alle.length === 0) {
			this.nachricht("Es sind keine Anbieter für diese Art der Anmeldung bekannt.");
			return undefined;
		}

		if (vorgegeben) {
			const treffer = alle.find((p) => p.id === vorgegeben.toLowerCase());
			if (treffer) return { id: treffer.id, name: treffer.name };
			this.nachricht(`Keinen Anbieter namens „${vorgegeben}“ gefunden — bitte unten aus der Liste wählen.`);
		}

		const liste = alle
			.map((p, index) => `${index + 1} — ${p.name} (${p.id})`)
			.join("\n");
		const antwort = (await this.frage(`Welcher Anbieter?\n${liste}\n\nAntworte mit Ziffer oder Name:`)).trim();

		const zahl = Number.parseInt(antwort, 10);
		if (Number.isFinite(zahl) && zahl >= 1 && zahl <= alle.length) {
			const gewählt = alle[zahl - 1];
			return { id: gewählt.id, name: gewählt.name };
		}
		const textuell = alle.find((p) => p.id.includes(antwort.toLowerCase()) || p.name.toLowerCase().includes(antwort.toLowerCase()));
		if (textuell) return { id: textuell.id, name: textuell.name };
		this.nachricht("Abgebrochen — die Auswahl war nicht erkennbar.");
		return undefined;
	}

	/** Schritt-für-Schritt: eigener OpenAI-kompatibler Endpunkt. */
	private async customLogin(): Promise<void> {
		const endpunkt = (await this.frage(
			"Endpunkt des Modells (z. B. http://localhost:11434/v1 für Ollama):",
		)).trim();
		if (!endpunkt) {
			this.nachricht("Abgebrochen.");
			return;
		}
		const schluessel = (await this.frage(
			"API-Key (falls nötig — sonst nur `-` eingeben und mit Enter bestätigen):",
		)).trim();
		const keinKey = !schluessel || schluessel === "-";

		// Modell wählen: wenn der Endpunkt eine Modellliste liefert (LM Studio,
		// Ollama & Co. tun das), per Ziffer — sonst als Text tippen.
		let modellId: string;
		const katalog = await fetchRemoteModels(endpunkt, keinKey ? "" : schluessel).catch(() => [] as string[]);
		if (katalog.length > 0) {
			const liste = katalog.map((name, index) => `${index + 1} — ${name}`).join("\n");
			const antwort = (
				await this.frage(`Modelle am Endpunkt:\n${liste}\n\nAntworte mit Ziffer oder tippe eine Modell-ID:`)
			).trim();
			if (!antwort || antwort === "-") {
				this.nachricht("Abgebrochen — ohne Modell-ID geht es nicht.");
				return;
			}
			const zahl = Number.parseInt(antwort, 10);
			modellId =
				Number.isFinite(zahl) && zahl >= 1 && zahl <= katalog.length ? katalog[zahl - 1] : antwort;
		} else {
			modellId = (
				await this.frage(
					"Modell-ID (z. B. llama3.1:8b) — Hinweis: „/-Commands“ brechen diesen Dialog ab:",
				)
			).trim();
		}
		if (!modellId) {
			this.nachricht("Abgebrochen — ohne Modell-ID geht es nicht.");
			return;
		}
		// Pi listet Provider ohne Credentials gar nicht erst — lokale Endpunkte
		// ohne Key bekommen deshalb einen Platzhalter (wird von LM Studio &
		// Co. ignoriert).
		const config = await validateByomConfig({
			baseUrl: endpunkt,
			apiKey: keinKey ? "kein-key" : schluessel,
			modelId: modellId,
		});
		await applyByomToSession(this.pi, config);
		this.nachricht(`Fertig! Verbunden mit **${config.modelId}** über ${config.displayName}.`);
	}

	/**
	 * /settings — derselbe Katalog wie im CLI-Einstellungsdialog, geführt im
	 * Chat: Nummer wählen, Boolesche Werte kippen sofort, Aufzählungen fragen
	 * ihre Optionen ab. Alles läuft über pi.settingsManager und wird
	 * persistiert. Reine TUI-Ansichten (Theme-Auswahl, Warnings-Konfigurator)
	 * werden ehrlich als nur-im-Terminal gekennzeichnet.
	 */
	private async einstellungenKommando(): Promise<void> {
		const sm = this.pi.settingsManager;
		const ja = (wert: boolean) => (wert ? "an" : "aus");

		interface Eintrag {
			label: string;
			lesen: () => string;
			schreiben?: () => Promise<string>;
		}

		const einträge: Eintrag[] = [
			{
				label: "Auto-compact",
				lesen: () => ja(sm.getCompactionEnabled()),
				schreiben: async () => {
					const an = !sm.getCompactionEnabled();
					sm.setCompactionEnabled(an);
					this.pi.setAutoCompactionEnabled(an);
					return `Auto-Kompaktierung ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Auto-resize images",
				lesen: () => ja(sm.getImageAutoResize()),
				schreiben: async () => {
					const an = !sm.getImageAutoResize();
					sm.setImageAutoResize(an);
					return `Automatische Bildgröße ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Block images",
				lesen: () => ja(sm.getBlockImages()),
				schreiben: async () => {
					const blockiert = !sm.getBlockImages();
					sm.setBlockImages(blockiert);
					return `Bilder sind jetzt **${blockiert ? "blockiert" : "erlaubt"}**.`;
				},
			},
			{
				label: "Skill commands",
				lesen: () => ja(sm.getEnableSkillCommands()),
				schreiben: async () => {
					const an = !sm.getEnableSkillCommands();
					sm.setEnableSkillCommands(an);
					return `Skill-Commands sind jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Show hardware cursor",
				lesen: () => ja(sm.getShowHardwareCursor()),
				schreiben: async () => {
					const an = !sm.getShowHardwareCursor();
					sm.setShowHardwareCursor(an);
					return `Hardware-Cursor ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Editor padding",
				lesen: () => String(sm.getEditorPaddingX()),
				schreiben: async () => {
					const wert = Number.parseInt(await this.frage("Neuer Wert für Editor-Padding (Zahl):"), 10);
					if (!Number.isFinite(wert)) return "Keine gültige Zahl — abgebrochen.";
					sm.setEditorPaddingX(Math.max(0, wert));
					return `Editor-Padding gesetzt: **${Math.max(0, wert)}**.`;
				},
			},
			{
				label: "Output padding",
				lesen: () => String(sm.getOutputPad()),
				schreiben: async () => {
					const wert = Number.parseInt(await this.frage("Output-Padding (0 oder 1):"), 10);
					if (wert !== 0 && wert !== 1) return "Nur 0 oder 1 möglich — abgebrochen.";
					sm.setOutputPad(wert);
					return `Output-Padding gesetzt: **${wert}**.`;
				},
			},
			{
				label: "Autocomplete max items",
				lesen: () => String(sm.getAutocompleteMaxVisible()),
				schreiben: async () => {
					const wert = Number.parseInt(await this.frage("Maximale Anzahl Vorschläge (Zahl):"), 10);
					if (!Number.isFinite(wert) || wert < 1) return "Bitte eine Zahl ≥ 1 — abgebrochen.";
					sm.setAutocompleteMaxVisible(wert);
					return `Autocomplete-Vorschläge: **${wert}**.`;
				},
			},
			{
				label: "Clear on shrink",
				lesen: () => ja(sm.getClearOnShrink()),
				schreiben: async () => {
					const an = !sm.getClearOnShrink();
					sm.setClearOnShrink(an);
					return `Clear-on-shrink ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Terminal progress",
				lesen: () => ja(sm.getShowTerminalProgress()),
				schreiben: async () => {
					const an = !sm.getShowTerminalProgress();
					sm.setShowTerminalProgress(an);
					return `Terminal-Fortschritt ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Steering mode",
				lesen: () => (sm.getSteeringMode() === "all" ? "alle auf einmal" : "einzeln nacheinander"),
				schreiben: async () => {
					const modus = await this.auswahl("Steering-Modus?", [
						["alle", "all"],
						["einzeln", "one-at-a-time"],
					]);
					if (!modus) return "Abgebrochen.";
					sm.setSteeringMode(modus);
					this.pi.setSteeringMode(modus);
					return `Steering-Modus: **${modus === "all" ? "alle auf einmal" : "einzeln nacheinander"}**.`;
				},
			},
			{
				label: "Follow-up mode",
				lesen: () => (sm.getFollowUpMode() === "all" ? "alle auf einmal" : "einzeln nacheinander"),
				schreiben: async () => {
					const modus = await this.auswahl("Follow-up-Modus?", [
						["alle", "all"],
						["einzeln", "one-at-a-time"],
					]);
					if (!modus) return "Abgebrochen.";
					sm.setFollowUpMode(modus);
					this.pi.setFollowUpMode(modus);
					return `Follow-up-Modus: **${modus === "all" ? "alle auf einmal" : "einzeln nacheinander"}**.`;
				},
			},
			{
				label: "Transport",
				lesen: () => String(sm.getTransport()),
				schreiben: async () => {
					const modus = await this.auswahl(
						"Transport?",
						Object.entries({ auto: "auto", sse: "sse", websocket: "websocket", "websocket-cached": "websocket-cached" }),
					);
					if (!modus) return "Abgebrochen.";
					sm.setTransport(modus as never);
					return `Transport: **${modus}**.`;
				},
			},
			{
				label: "HTTP idle timeout",
				lesen: () => `${Math.round(sm.getHttpIdleTimeoutMs() / 60000)} min`,
				schreiben: async () => {
					const minuten = Number.parseInt(await this.frage("Idle-Timeout in Minuten (Zahl):"), 10);
					if (!Number.isFinite(minuten) || minuten < 1) return "Bitte Minutenzahl ≥ 1 — abgebrochen.";
					sm.setHttpIdleTimeoutMs(minuten * 60_000);
					return `HTTP-Idle-Timeout: **${minuten} min**.`;
				},
			},
			{
				label: "Hide thinking",
				lesen: () => ja(sm.getHideThinkingBlock()),
				schreiben: async () => {
					const verstecken = !sm.getHideThinkingBlock();
					sm.setHideThinkingBlock(verstecken);
					return `Denkblöcke werden jetzt **${verstecken ? "versteckt" : "angezeigt"}**.`;
				},
			},
			{
				label: "Mermaid diagrams",
				lesen: () => String(sm.getMermaidRenderingMode()),
				schreiben: async () => {
					const modus = await this.auswahl("Mermaid-Darstellung?", [
						["streaming", "streaming"],
						["final", "final"],
						["aus", "off"],
					]);
					if (!modus) return "Abgebrochen.";
					sm.setMermaidRenderingMode(modus as never);
					return `Mermaid-Darstellung: **${modus}**.`;
				},
			},
			{
				label: "Cache miss notices",
				lesen: () => ja(sm.getShowCacheMissNotices()),
				schreiben: async () => {
					const an = !sm.getShowCacheMissNotices();
					sm.setShowCacheMissNotices(an);
					return `Cache-Miss-Hinweise sind jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Collapse changelog",
				lesen: () => ja(sm.getCollapseChangelog()),
				schreiben: async () => {
					const eingeklappt = !sm.getCollapseChangelog();
					sm.setCollapseChangelog(eingeklappt);
					return `Changelog wird jetzt **${eingeklappt ? "eingeklappt" : "ausgeklappt"}** angezeigt.`;
				},
			},
			{
				label: "Quiet startup",
				lesen: () => ja(sm.getQuietStartup()),
				schreiben: async () => {
					const still = !sm.getQuietStartup();
					sm.setQuietStartup(still);
					return `Stiller Start ist jetzt **${ja(still)}**.`;
				},
			},
			{
				label: "Install telemetry",
				lesen: () => ja(sm.getEnableInstallTelemetry()),
				schreiben: async () => {
					const an = !sm.getEnableInstallTelemetry();
					sm.setEnableInstallTelemetry(an);
					return `Installations-Telemetrie ist jetzt **${ja(an)}**.`;
				},
			},
			{
				label: "Default project trust",
				lesen: () => String(sm.getDefaultProjectTrust()),
				schreiben: async () => {
					const modus = await this.auswahl(
						"Wie soll mit neuen Projekten umgegangen werden?",
						[
							["fragen", "ask"],
							["immer vertrauen", "always"],
							["nie vertrauen", "never"],
						],
					);
					if (!modus) return "Abgebrochen.";
					sm.setDefaultProjectTrust(modus as never);
					return `Standard-Projektvertrauen: **${modus}**.`;
				},
			},
			{
				label: "Double-escape action",
				lesen: () => String(sm.getDoubleEscapeAction()),
				schreiben: async () => {
					const aktion = await this.auswahl("Doppel-Escape soll …?", [
						["Session-Baum öffnen", "tree"],
						["Fork erzeugen", "fork"],
						["nichts tun", "none"],
					]);
					if (!aktion) return "Abgebrochen.";
					sm.setDoubleEscapeAction(aktion as never);
					return `Doppel-Escape-Aktion: **${aktion}**.`;
				},
			},
			{
				label: "Tree filter mode",
				lesen: () => String(sm.getTreeFilterMode()),
				schreiben: async () => {
					const modus = await this.auswahl(
						"Baumfilter?",
						Object.entries({
							default: "default",
							"ohne Werkzeuge": "no-tools",
							"nur Nutzer": "user-only",
							"nur Markierungen": "labeled-only",
							alles: "all",
						}),
					);
					if (!modus) return "Abgebrochen.";
					sm.setTreeFilterMode(modus as never);
					return `Baumfilter: **${modus}**.`;
				},
			},
			{
				label: "Thinking level",
				lesen: () => sm.getDefaultThinkingLevel() ?? "(Modell-Standard)",
				schreiben: async () => {
					const erlaubt: string[] = this.pi.getAvailableThinkingLevels();
					if (erlaubt.length === 0) return "Dieses Modell unterstützt kein Denklevel.";
					const liste = erlaubt.join(" / ");
					const antwort = (await this.frage(`Denklevel (${liste}):`)).trim().toLowerCase() as never;
					if (!erlaubt.includes(antwort)) {
						return `„${String(antwort)}“ ist für dieses Modell nicht verfügbar. Abgebrochen.`;
					}
					sm.setDefaultThinkingLevel(antwort);
					this.pi.setThinkingLevel(antwort);
					return `Denklevel gesetzt: **${String(antwort)}**.`;
				},
			},
			{
				label: "TUI mode",
				lesen: () => `${String(sm.getTuiMode())} *(nur Terminal)*`,
				schreiben: async () =>
					"Der TUI-Modus betrifft nur das Terminal — hier im Editor ohne Wirkung.",
			},
			{
				label: "Fullscreen exit output",
				lesen: () => String(sm.getFullscreenExitOutput()),
				schreiben: async () => {
					const modus = await this.auswahl("Beim Verlassen des Vollbilds zeigen:", [
						["Transkript", "transcript"],
						["Hinweis zum Fortsetzen", "resume-hint"],
					]);
					if (!modus) return "Abgebrochen.";
					sm.setFullscreenExitOutput(modus as never);
					return `Vollbild-Ausgang: **${modus}**.`;
				},
			},
			{
				label: "Fullscreen scrollbar",
				lesen: () => String(sm.getFullscreenScrollbar()),
				schreiben: async () => {
					const modus = await this.auswahl("Scrollleiste im Vollbild:", [
						["automatisch", "auto"],
						["immer", "always"],
						["nie", "hidden"],
					]);
					if (!modus) return "Abgebrochen.";
					sm.setFullscreenScrollbar(modus as never);
					return `Scrollleiste: **${modus}**.`;
				},
			},
			{
				label: "Theme",
				lesen: () => `${sm.getThemeSetting() ?? "(Standard)"} *(Auswahl nur im Terminal)*`,
			},
			{
				label: "Warnings",
				lesen: () => JSON.stringify(sm.getWarnings()) + " *(Konfiguration nur im Terminal)*",
			},
		];

		for (;;) {
			const menü = einträge
				.map((eintrag, index) => `**${index + 1}** — ${eintrag.label}: ${eintrag.lesen()}`)
				.join("\n");
			this.nachricht(
				`**Einstellungen** — Ziffer eingeben zum Ändern (Boolesche Werte kippen direkt):\n${menü}\n\n` +
					"Fertig? Schreib einfach etwas anderes.",
			);
			const wahl = (await this.frage("Nummer (oder fertig):")).trim();
			const index = Number.parseInt(wahl, 10);
			if (!Number.isFinite(index) || index < 1 || index > einträge.length) {
				this.nachricht("Einstellungen geschlossen.");
				return;
			}
			const eintrag = einträge[index - 1];
			if (!eintrag.schreiben) {
				this.nachricht(`„${eintrag.label}" ist hier nicht änderbar — ${eintrag.lesen()}`);
				continue;
			}
			try {
				this.nachricht(await eintrag.schreiben());
			} catch (fehler) {
				this.nachricht(`Nicht geändert: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		}
	}

	/** Ja/Nein- bzw. Optionsfrage; Antwort (kleingeschrieben) oder undefined bei Abbruch. */
	private async auswahl(frage: string, optionen: Array<[beschriftung: string, wert: string]>): Promise<string | undefined> {
		const liste = optionen.map(([beschriftung], index) => `${index + 1} — ${beschriftung}`).join("\n");
		const antwort = (await this.frage(`${frage}\n${liste}\n\nAntworte mit Ziffer oder Text:`)).trim().toLowerCase();
		if (!antwort || antwort === "abbrechen") return undefined;
		const zahl = Number.parseInt(antwort, 10);
		if (Number.isFinite(zahl) && zahl >= 1 && zahl <= optionen.length) {
			return optionen[zahl - 1][1];
		}
		const treffer = optionen.find(
			([beschriftung, wert]) =>
				beschriftung.toLowerCase().includes(antwort) || wert.includes(antwort),
		);
		return treffer?.[1];
	}

	private async logoutKommando(provider: string): Promise<void> {
		const laufwerke = this.pi as unknown as {
			modelRuntime: {
				getProviders(): readonly { id: string; name?: string }[];
				getProviderAuthStatus(id: string): { configured: boolean };
			};
		};

		// Ohne Angabe: angemeldete Provider auflisten und interaktiv wählen.
		if (!provider) {
			const angemeldet = laufwerke.modelRuntime
				.getProviders()
				.filter((p) => laufwerke.modelRuntime.getProviderAuthStatus(p.id)?.configured);
			if (angemeldet.length === 0) {
				this.nachricht("Es ist kein Provider angemeldet.");
				return;
			}
			if (angemeldet.length === 1) {
				await this.logoutKommando(angemeldet[0].id);
				return;
			}
			const wahl = await this.auswahl(
				"Welcher Provider soll abgemeldet werden?",
				angemeldet.map((p) => [p.name ?? p.id, p.id] as [string, string]),
			);
			if (!wahl) {
				this.nachricht("Abgebrochen.");
				return;
			}
			await this.logoutKommando(wahl);
			return;
		}
		try {
			await this.pi.modelRuntime.logout(provider);
			this.nachricht(`${provider} wurde abgemeldet.`);
			// War das aktive Modell von diesem Provider? Dann ist es jetzt
			// unbrauchbar — klar sagen statt auf einen 401 warten.
			const pi = this.pi as unknown as { model?: { provider?: string } };
			if (pi.model?.provider === provider) {
				this.nachricht(
					`Das aktive Modell gehört zu ${provider} und funktioniert ohne Anmeldung nicht mehr — bitte neu anmelden (/login) oder anderes Modell wählen.`,
				);
			}
			this.aktualisieren();
		} catch (fehler) {
			this.nachricht(`Abmelden fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
		}
	}

	/**
	 * Eine Rückfrage im Chat stellen und auf die nächste Nutzernachricht
	 * warten (wird in prompt() abgefangen und aufgelöst).
	 */
	private frage(text: string): Promise<string> {
		return new Promise((resolve) => {
			this.frageOffen = resolve;
			this.nachricht(text);
		});
	}

	private fehlermeldung(fehler: unknown): void {
		const text = fehler instanceof Error ? fehler.message : String(fehler);
		this.sendeUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `**Fehler:** ${text}\n`,
			},
		});
		// Der häufigste Fehler in frischen Sessions: kein Modell/Key vorhanden.
		if (/api key|no model|not authenticated|auth/i.test(text)) {
			this.nachricht(
				"Es sieht so aus, als wäre kein Modell angemeldet. Tippe **/login** — API-Key, Browser-Anmeldung (Claude Pro/Max & Co.) oder eigener Endpunkt, geführt im Chat.",
			);
		}
	}

	abbrechen(): void {
		void this.pi.abort().catch(() => {});
	}

	/**
	 * Modelle, deren Provider tatsächlich angemeldet ist. Der Roh-Katalog
	 * enthält auch Provider ohne gültige Credentials — wählt man deren
	 * Modelle, gibt es erst beim Zug einen 401.
	 */
	private async verfuegbareModelle(): Promise<Array<{ id: string; provider?: string }>> {
		const laufwerk = this.pi as unknown as {
			modelRuntime: {
				getAvailable(): Promise<readonly { id: string; provider?: string }[]>;
				getProviders(): readonly { id: string }[];
				getProviderAuthStatus?(id: string): { configured?: boolean };
			};
		};
		const modelle = await laufwerk.modelRuntime.getAvailable().catch(() => []);
		if (typeof laufwerk.modelRuntime.getProviders !== "function") return [...modelle];
		const konfiguriert = new Set(
			laufwerk.modelRuntime
				.getProviders()
				.filter((p) => laufwerk.modelRuntime.getProviderAuthStatus?.(p.id)?.configured ?? true)
				.map((p) => p.id),
		);
		return modelle.filter((m) => !m.provider || konfiguriert.has(m.provider));
	}

	/** Nach einem Login: falls nötig auf das erste Modell des Providers wechseln. */
	private async modellDesProvidersAktivieren(providerId: string): Promise<void> {
		const pi = this.pi as unknown as { model?: { provider?: string } };
		if (pi.model?.provider === providerId) return;
		const modelle = await this.verfuegbareModelle();
		const ziel = modelle.find((m) => m.provider === providerId);
		if (!ziel) {
			this.nachricht(`Für ${providerId} sind keine Modelle im Katalog — Modell bitte manuell wählen.`);
			return;
		}
		await this.pi.setModel(ziel as never);
		this.nachricht(`Aktives Modell: ${ziel.id} (${providerId}).`);
		this.aktualisieren();
	}

	/**
	 * Status für Editor-Fußleisten (VS Code): aktives Modell, Thinking-Stufe,
	 * Kontext-Füllstand. Bewusst eine eigene Methode statt ACP-Standard —
	 * Clients, die sie nicht kennen, verlieren nichts.
	 */
	async status(): Promise<Record<string, unknown>> {
		const modelle = await this.verfuegbareModelle().catch(() => []);
		const pi = this.pi as unknown as {
			model?: { id?: string };
			getThinkingLevel?: () => string;
			getAvailableThinkingLevels?: () => string[];
			getContextUsage?: () => { tokens: number | null; contextWindow?: number; percent?: number } | null;
		};
		const kontext = pi.getContextUsage?.() ?? null;
		return {
			modell: pi.model?.id ?? null,
			modelle: modelle.map((m) => m.id),
			thinking: typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : null,
			thinkingStufen: typeof pi.getAvailableThinkingLevels === "function" ? pi.getAvailableThinkingLevels() : [],
			kontext:
				kontext && kontext.tokens !== null
					? { tokens: kontext.tokens, fenster: kontext.contextWindow ?? null, prozent: Math.round(kontext.percent ?? 0) }
					: null,
		};
	}

	/** Modell wechseln (Fußleiste / session/set_model). */
	async modellSetzen(id: string): Promise<void> {
		const modelle = await this.verfuegbareModelle();
		const ziel = modelle.find((kandidat) => kandidat.id === id || `${kandidat.provider}:${kandidat.id}` === id);
		if (!ziel) {
			throw new Error(
				`Modell „${id}“ ist nicht verfügbar (nur angemeldete Provider werden angeboten — ggf. /login).`,
			);
		}
		await this.pi.setModel(ziel as never);
		this.nachricht(`Modell gewechselt: ${ziel.id}`);
		this.aktualisieren();
	}

	/** Thinking-Stufe setzen (Fußleiste / session/set_thinking). */
	thinkingSetzen(level: string): void {
		const pi = this.pi as unknown as { setThinkingLevel?: (level: string) => void };
		if (typeof pi.setThinkingLevel !== "function") {
			this.nachricht("Thinking-Stufen kennt dieses Modell nicht.");
			return;
		}
		pi.setThinkingLevel(level);
		this.nachricht(`Thinking-Stufe: ${level}`);
		this.aktualisieren();
	}

	/** /model — ohne Argument Liste, mit Argument Wechsel. */
	private async modellKommando(argument: string): Promise<void> {
		try {
			if (!argument) {
				const modelle = await this.verfuegbareModelle();
				if (modelle.length === 0) {
					this.nachricht("Es sind keine Modelle verfügbar — bitte zuerst `/login api <provider>` oder `/login custom` ausführen.");
					return;
				}
				const zeilen = modelle.map((modell) => {
					const aktuell = this.pi.model?.id === modell.id ? "  ← aktiv" : "";
					return `- ${modell.id}${aktuell}`;
				});
				this.nachricht(`Verfügbare Modelle (angemeldete Provider):\n${zeilen.join("\n")}\n\nWechseln mit /model <modell-id>`);
				return;
			}
			const modelle = await this.verfuegbareModelle();
			const ziel = modelle.find((kandidat) => kandidat.id === argument || `${kandidat.provider}:${kandidat.id}` === argument);
			if (!ziel) {
				this.nachricht(
					`Modell „${argument}“ ist nicht verfügbar (nur angemeldete Provider). /model ohne Argument zeigt die Liste.`,
				);
				return;
			}
			await this.pi.setModel(ziel as never);
			this.nachricht(`Modell gewechselt: ${ziel.id}`);
		this.aktualisieren();
		} catch (fehler) {
			this.nachricht(`Fehler beim Modell-Wechsel: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
		}
	}

	private weiterleiten(ereignis: { type: string; [key: string]: unknown }): void {
		switch (ereignis.type) {
			case "message_start":
			case "message_update":
			case "message_end": {
				const message = ereignis.message as {
					role?: string;
					stopReason?: string;
					errorMessage?: string;
					provider?: string;
					model?: string;
					content?: Array<{ type?: string; text?: string }>;
				};
				if (message?.role !== "assistant") return;

				// Provider-/Modellfehler kommen als Message mit stopReason "error"
				// und ohne Wurf — ohne diese Behandlung bliebe der Zug stumm.
				if (message.stopReason === "error") {
					if (ereignis.type === "message_end") {
						this.hatGeantwortet = true;
						const kontext = [message.provider, message.model].filter(Boolean).join("/");
						this.fehlermeldung(
							new Error(
								kontext
									? `${kontext}: ${message.errorMessage ?? "Unbekannter Modellfehler."}`
									: message.errorMessage ?? "Unbekannter Modellfehler.",
							),
						);
					}
					return;
				}

				// Denk-Protokoll als eigener Kanal (ACP: agent_thought_chunk).
				const denken = (message.content ?? [])
					.filter((block) => block?.type === "thinking")
					.map((block) => block.text ?? "")
					.join("");
				if (denken) {
					if (ereignis.type === "message_start") this.denkGesendet = 0;
					const denkNeu = denken.length > this.denkGesendet ? denken.slice(this.denkGesendet) : "";
					this.denkGesendet = denken.length;
					if (denkNeu) {
						this.sendeUpdate({
							sessionUpdate: "agent_thought_chunk",
							content: { type: "text", text: denkNeu },
						});
					}
				}

				const text = extractText(ereignis.message);
				// agent_message_chunk ist ein Delta — nur den Zuwachs seit der
				// letzten Meldung schicken (sonst verdoppeln Clients den Text und
				// das Markdown-Endrendering geht daneben).
				if (ereignis.type === "message_start") this.gesendet = 0;
				const neu = text.length > this.gesendet ? text.slice(this.gesendet) : "";
				this.gesendet = text.length;
				if (!neu) return;
				this.hatGeantwortet = true;
				this.sendeUpdate({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: neu },
				});
				break;
			}
			case "tool_execution_start":
				this.sendeUpdate({
					sessionUpdate: "tool_call",
					toolCallId: String(ereignis.toolCallId ?? `${ereignis.toolName}-${Date.now()}`),
					title: String(ereignis.toolName ?? "Werkzeug"),
					kind: "other",
					status: "in_progress",
				});
				break;
			case "tool_execution_end":
				this.sendeUpdate({
					sessionUpdate: "tool_call_update",
					toolCallId: String(ereignis.toolCallId ?? ""),
					status: ereignis.isError === true ? "failed" : "completed",
				});
				break;
		}
	}

	dispose(): void {
		this.unsubscribe();
		this.bridge.schliessen();
		this.pi.dispose();
	}
}
