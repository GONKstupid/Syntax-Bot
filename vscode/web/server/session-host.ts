/**
 * Session-Host — eine Pi-Session pro Browser-Verbindung.
 *
 * Jede Verbindung bekommt einen eigenen Arbeitsbereich unter
 * `~/.syntax-bot/web-workspaces/` und eine eigene AgentSession aus dem Pi SDK.
 * Das Web-Jail sperrt alle Werkzeuge auf diesen Bereich ein; die UI-Bridge
 * leitet Dialoge (vor allem die Diff-Rückfrage) in den Browser.
 *
 * Der Modus-Zustand der Extensions liegt pro Session (siehe mode-core.ts),
 * deshalb stören sich parallele Verbindungen hier nicht gegenseitig.
 */

import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { WebUser } from "./auth.ts";
import { applyByomToSession, fetchRemoteModels, validateByomConfig } from "./byom.ts";
import { createJailExtension } from "./jail-extension.ts";
import { kontoIdVon, ProviderStore } from "./provider-store.ts";
import { WebUiBridge, type ServerMessage } from "./ui-bridge.ts";

export interface SessionHostOptions {
	/** Konfigurationsverzeichnis der isolierten Instanz (~/.syntax-bot/agent). */
	agentDir: string;
	/** Wurzel, unter der pro Verbindung ein Arbeitsbereich angelegt wird. */
	workspacesDir: string;
	/** Freies bash erlauben (SYNTAX_BOT_WEB_BASH=1). */
	allowBash: boolean;
	/** Gespeicherte Provider je Konto — unabhängig von der Anmeldung. */
	providers: ProviderStore;
}

/** Nachrichten Browser → Server. */
export type ClientMessage =
	| { type: "user_message"; text: string }
	| { type: "ui_response"; requestId: number; value: unknown }
	| { type: "interrupt" }
	| { type: "byom_test"; baseUrl: string; apiKey: string }
	| { type: "byom_save"; config: unknown }
	| { type: "byom_list" }
	| { type: "byom_delete"; providerId: string }
	| { type: "byom_activate"; providerId: string }
	| { type: "set_thinking"; level: string }
	| { type: "file_upload"; name: string; content: string }
	| { type: "new_thread" };

/** Obergrenze für Datei-Anhänge (Base64-Transport über WebSocket). */
const ANHANG_MAX_BYTES = 10 * 1024 * 1024;

/** Textanteil einer Assistenten-Nachricht (Denkblöcke und Werkzeugaufrufe ausgeblendet). */
function extractText(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text")
		.map((block) => block.text)
		.join("");
}

/** Denktext einer Assistenten-Nachricht — für die einklappbaren Denk-Blöcke. */
function extractThinking(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "thinking"; thinking: string } => block?.type === "thinking" && typeof block.thinking === "string")
		.map((block) => block.thinking)
		.join("");
}

export class SessionHost {
	private readonly options: SessionHostOptions;

	constructor(options: SessionHostOptions) {
		this.options = options;
	}

	async open(send: (message: ServerMessage | Record<string, unknown>) => void, user?: WebUser): Promise<HostedSession> {
		// Angemeldete Nutzer bekommen einen dauerhaften Arbeitsbereich, anonyme
		// Verbindungen (Localhost-Betrieb ohne OAuth) einen Wegwerf-Bereich.
		const bereich = user
			? `nutzer-${user.id.replace(/[^a-zA-Z0-9_-]/g, "")}`
			: `session-${new Date().toISOString().slice(0, 10)}-${randomInt(100000, 999999)}`;
		const workspace = join(this.options.workspacesDir, bereich);
		await mkdir(workspace, { recursive: true });

		const bridge = new WebUiBridge(send);

		const loader = new DefaultResourceLoader({
			cwd: workspace,
			agentDir: this.options.agentDir,
			extensionFactories: [createJailExtension({ root: workspace, allowBash: this.options.allowBash })],
		});
		await loader.reload();

		const { session, modelFallbackMessage } = await createAgentSession({
			cwd: workspace,
			agentDir: this.options.agentDir,
			resourceLoader: loader,
		});

		await session.bindExtensions({
			uiContext: bridge.ui,
			mode: "rpc",
			onError: (error) => {
				send({ type: "notify", level: "error", message: `Extension-Fehler: ${error.error}` });
			},
		});

		return new HostedSession(session, bridge, workspace, send, this.options.providers, kontoIdVon(user), modelFallbackMessage, user);
	}
}

export class HostedSession {
	private readonly unsubscribe: () => void;
	private readonly bridge: WebUiBridge;
	private readonly send: (message: ServerMessage | Record<string, unknown>) => void;
	readonly session: AgentSession;
	readonly workspace: string;
	readonly user?: WebUser;
	readonly kontoId: string;
	private readonly providers: ProviderStore;
	/** Drossel für Verbindungstests (BYOM): Zeitstempel der letzten Tests. */
	private byomTests: number[] = [];

	constructor(
		session: AgentSession,
		bridge: WebUiBridge,
		workspace: string,
		send: (message: ServerMessage | Record<string, unknown>) => void,
		providers: ProviderStore,
		kontoId: string,
		modelFallbackMessage?: string,
		user?: WebUser,
	) {
		this.session = session;
		this.workspace = workspace;
		this.user = user;
		this.kontoId = kontoId;
		this.bridge = bridge;
		this.send = send;
		this.providers = providers;
		this.unsubscribe = session.subscribe((event) => this.forwardEvent(event));

		send({ type: "ready", workspace, model: session.model?.name ?? null, user: this.user?.login ?? null });
		this.sendeZustand();
		if (!session.model) {
			// Noch kein Modell: Gespeicherten Provider des Kontos automatisch
			// aktivieren — die Anmeldung ist dafür nicht nötig.
			void this.autoAktivieren();
		} else if (modelFallbackMessage) {
			send({ type: "notify", level: "warning", message: modelFallbackMessage });
		}
	}

	private async autoAktivieren(): Promise<void> {
		try {
			const gespeicherter = await this.providers.erster(this.kontoId);
			if (!gespeicherter) {
				this.send({
					type: "notify",
					level: "warning",
					message:
						"Es ist noch kein Modell eingerichtet. Öffne oben »Konto« und verbinde " +
						"deinen eigenen OpenAI-kompatiblen Endpunkt (BYOM).",
				});
				return;
			}
			await applyByomToSession(this.session, gespeicherter);
			this.send({
				type: "notify",
				level: "info",
				message: `Gespeicherter Provider verbunden: ${gespeicherter.modelId} (${gespeicherter.displayName})`,
			});
			this.send({ type: "model_changed", model: this.session.model?.name ?? gespeicherter.modelId });
			this.sendeZustand();
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: `Gespeicherter Provider konnte nicht verbunden werden: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	async handleMessage(message: ClientMessage): Promise<void> {
		switch (message.type) {
			case "user_message":
				await this.prompt(message.text);
				break;
			case "ui_response":
				this.bridge.handleResponse(message.requestId, message.value);
				break;
			case "interrupt":
				await this.session.abort();
				break;
			case "byom_test":
				await this.byomTest(message.baseUrl, message.apiKey);
				break;
			case "byom_save":
				await this.byomSave(message.config);
				break;
			case "byom_list":
				await this.byomList();
				break;
			case "byom_delete":
				await this.byomDelete(message.providerId);
				break;
			case "byom_activate":
				await this.byomActivate(message.providerId);
				break;
			case "set_thinking":
				this.setThinking(message.level);
				break;
			case "file_upload":
				await this.fileUpload(message.name, message.content);
				break;
			// "new_thread" behandelt der Server-Einstieg selbst (Session-Neuaufbau).
			case "new_thread":
				break;
		}
	}

	/**
	 * Vollständiger Sitzungszustand für die Aktionsleiste: Modell,
	 * Thinking-Stufe samt verfügbarer Stufen und Kontext-Füllstand.
	 */
	private sendeZustand(): void {
		let kontext: { prozent: number | null; tokens: number | null; fenster: number } | null = null;
		try {
			const nutzung = this.session.getContextUsage();
			if (nutzung) {
				kontext = { prozent: nutzung.percent, tokens: nutzung.tokens, fenster: nutzung.contextWindow };
			}
		} catch {
			// Ohne Kontextdaten bleibt die Anzeige auf „—“.
		}
		let stufen: string[] = [];
		try {
			stufen = this.session.getAvailableThinkingLevels() as string[];
		} catch {
			// Ohne Modell keine Stufen.
		}
		this.send({
			type: "session_state",
			model: this.session.model?.name ?? null,
			thinkingLevel: stufen.length > 0 ? this.session.thinkingLevel : null,
			thinkingStufen: stufen,
			kontext,
		});
	}

	private setThinking(level: string): void {
		const stufen = this.session.getAvailableThinkingLevels() as string[];
		if (!stufen.includes(level)) {
			this.send({
				type: "notify",
				level: "warning",
				message:
					stufen.length === 0
						? "Das aktuelle Modell unterstützt kein Thinking."
						: `Unbekannte Thinking-Stufe „${level}“. Verfügbar: ${stufen.join(", ")}`,
			});
			return;
		}
		this.session.setThinkingLevel(level as never);
		this.send({ type: "notify", level: "info", message: `Thinking-Stufe: ${level}` });
		this.sendeZustand();
	}

	/** Datei-Anhang in den Arbeitsbereich legen (unterhalb des Jails). */
	private async fileUpload(name: string, contentBase64: string): Promise<void> {
		const basisName = String(name ?? "")
			.split(/[\\/]/)
			.pop()
			?.replace(/[^a-zA-Z0-9._äöüÄÖÜß-]/g, "_")
			.slice(0, 120);
		if (!basisName) {
			this.send({ type: "notify", level: "error", message: "Der Dateiname ist ungültig." });
			return;
		}
		let puffer: Buffer;
		try {
			puffer = Buffer.from(String(contentBase64 ?? ""), "base64");
		} catch {
			this.send({ type: "notify", level: "error", message: "Der Dateiinhalt ist ungültig." });
			return;
		}
		if (puffer.length === 0) {
			this.send({ type: "notify", level: "error", message: "Die Datei ist leer." });
			return;
		}
		if (puffer.length > ANHANG_MAX_BYTES) {
			this.send({ type: "notify", level: "error", message: "Die Datei ist größer als 10 MB." });
			return;
		}
		try {
			const zielOrdner = join(this.workspace, "uploads");
			await mkdir(zielOrdner, { recursive: true });
			await writeFile(join(zielOrdner, basisName), puffer);
			this.send({ type: "file_uploaded", name: basisName, path: `uploads/${basisName}` });
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: `Datei konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	/** Verbindungstest: höchstens fünf Abfragen pro Minute pro Verbindung. */
	private async byomTest(baseUrl: string, apiKey: string): Promise<void> {
		const jetzt = Date.now();
		this.byomTests = this.byomTests.filter((zeit) => jetzt - zeit < 60000);
		if (this.byomTests.length >= 5) {
			this.send({ type: "notify", level: "warning", message: "Zu viele Verbindungstests — bitte kurz warten." });
			return;
		}
		this.byomTests.push(jetzt);

		try {
			const models = await fetchRemoteModels(baseUrl, apiKey);
			this.send({ type: "byom_models", models });
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async byomSave(rawConfig: unknown): Promise<void> {
		try {
			const config = await validateByomConfig(rawConfig);
			await applyByomToSession(this.session, config);
			// Unabhängig von der Anmeldung im Konto ablegen.
			await this.providers.speichere(this.kontoId, config);
			this.send({
				type: "notify",
				level: "info",
				message: `Modell verbunden und gespeichert: ${config.modelId} (${config.displayName})`,
			});
			this.send({ type: "model_changed", model: this.session.model?.name ?? config.modelId });
			this.sendeZustand();
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Liste ohne Schlüssel — der Browser bekommt nie die API-Keys zurück. */
	private async byomList(): Promise<void> {
		const liste = await this.providers.liste(this.kontoId);
		this.send({
			type: "providers",
			providers: liste.map((p) => ({
				providerId: p.providerId,
				displayName: p.displayName,
				baseUrl: p.baseUrl,
				modelId: p.modelId,
				hatKey: p.apiKey.length > 0,
			})),
		});
	}

	private async byomDelete(providerId: string): Promise<void> {
		const geloescht = await this.providers.loesche(this.kontoId, providerId);
		this.send({
			type: "notify",
			level: geloescht ? "info" : "warning",
			message: geloescht ? "Provider entfernt." : "Dieser Provider war nicht gespeichert.",
		});
		await this.byomList();
	}

	/** Gespeicherten Provider auf der Session aktivieren. */
	private async byomActivate(providerId: string): Promise<void> {
		try {
			const gespeicherter = await this.providers.hole(this.kontoId, providerId);
			if (!gespeicherter) {
				this.send({ type: "notify", level: "warning", message: "Dieser Provider ist nicht gespeichert." });
				return;
			}
			await applyByomToSession(this.session, gespeicherter);
			this.send({
				type: "notify",
				level: "info",
				message: `Modell verbunden: ${gespeicherter.modelId} (${gespeicherter.displayName})`,
			});
			this.send({ type: "model_changed", model: this.session.model?.name ?? gespeicherter.modelId });
			this.sendeZustand();
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async prompt(text: string): Promise<void> {
		try {
			await this.session.prompt(text);
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: `Fehler: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private forwardEvent(event: { type: string; [key: string]: unknown }): void {
		switch (event.type) {
			case "agent_start":
				this.send({ type: "working", on: true });
				break;
			case "agent_end":
				this.send({ type: "working", on: false });
				this.sendeZustand();
				break;
			case "message_start":
				if ((event.message as { role?: string })?.role === "assistant") {
					this.send({ type: "assistant_start" });
				}
				break;
			case "message_update":
				if ((event.message as { role?: string })?.role === "assistant") {
					const denkText = extractThinking(event.message);
					if (denkText) this.send({ type: "thought_update", text: denkText });
					this.send({ type: "assistant_update", text: extractText(event.message) });
				}
				break;
			case "message_end":
				if ((event.message as { role?: string })?.role === "assistant") {
					const denkText = extractThinking(event.message);
					if (denkText) this.send({ type: "thought_update", text: denkText });
					this.send({ type: "assistant_end", text: extractText(event.message) });
				}
				break;
			case "tool_execution_start":
				this.send({ type: "tool", phase: "start", toolName: event.toolName });
				break;
			case "tool_execution_end":
				this.send({
					type: "tool",
					phase: "end",
					toolName: event.toolName,
					isError: event.isError === true,
				});
				break;
		}
	}

	async dispose(): Promise<void> {
		this.unsubscribe();
		this.bridge.close();
		this.session.dispose();
	}
}

/** Standard-Pfade der isolierten Instanz — gespiegelt aus scripts/bootstrap.mjs. */
export function defaultSessionHostOptions(): SessionHostOptions {
	const home = process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot");
	return {
		agentDir: join(home, "agent"),
		workspacesDir: join(home, "web-workspaces"),
		allowBash: process.env.SYNTAX_BOT_WEB_BASH === "1",
		providers: new ProviderStore(join(home, "web-providers.json")),
	};
}
