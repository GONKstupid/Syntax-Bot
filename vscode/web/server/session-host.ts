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

import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { WebUser } from "./auth.ts";
import { applyByomToSession, fetchRemoteModels, validateByomConfig } from "./byom.ts";
import { createJailExtension } from "./jail-extension.ts";
import { credentialDateiFuer, KontoCredentialStore } from "./konto-credentials.ts";
import { kontoIdVon, ProviderStore } from "./provider-store.ts";
import { ThreadStore, type ThreadEintrag } from "./thread-store.ts";
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
	/** Thread-Verlauf je Konto (Fortsetzen über Pi-Session-Dateien). */
	threads: ThreadStore;
	/** Verzeichnis der Pro-Konto-Credential-Dateien (native Provider). */
	credentialsDir: string;
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
	| { type: "new_thread" }
	| { type: "thread_list" }
	| { type: "thread_open"; threadId: string }
	| { type: "thread_delete"; threadId: string }
	| { type: "provider_status" }
	| { type: "provider_login"; art: "api" | "oauth"; providerId: string; apiKey?: string }
	| { type: "provider_logout"; providerId: string };

/** Obergrenze für Datei-Anhänge (Base64-Transport über WebSocket). */
const ANHANG_MAX_BYTES = 10 * 1024 * 1024;

/** Textanteil einer Assistenten-Nachricht (Denkblöcke und Werkzeugaufrufe ausgeblendet). */
function extractText(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (typeof content === "string") return content;
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

	async open(send: (message: ServerMessage | Record<string, unknown>) => void, user?: WebUser, threadId?: string): Promise<HostedSession> {
		// Angemeldete Nutzer bekommen einen dauerhaften Arbeitsbereich, anonyme
		// Verbindungen (Localhost-Betrieb ohne Konto) einen Wegwerf-Bereich.
		const bereich = user
			? `nutzer-${user.id.replace(/[^a-zA-Z0-9_-]/g, "")}`
			: `session-${new Date().toISOString().slice(0, 10)}-${randomInt(100000, 999999)}`;
		const workspace = join(this.options.workspacesDir, bereich);
		await mkdir(workspace, { recursive: true });

		const kontoId = kontoIdVon(user);
		const bridge = new WebUiBridge(send);

		// Pro Konto ein eigener Credential-Store — so merkt sich das Konto seine
		// Provider-Anmeldungen (API-Keys und OAuth-Tokens), ohne dass sich Konten
		// die globale auth.json teilen. Anonym: rein im Arbeitsspeicher.
		const credentials = new KontoCredentialStore(
			user ? credentialDateiFuer(this.options.credentialsDir, kontoId) : null,
		);
		const modelRuntime = await ModelRuntime.create({
			credentials: credentials as never,
			modelsPath: join(this.options.agentDir, "models.json"),
		});

		// Thread fortsetzen? Session-Datei aus dem Index über SessionManager.open
		// wiederherstellen — wie session/load im IDE-Adapter.
		let threadEintrag: ThreadEintrag | undefined;
		let sessionManager: SessionManager | undefined;
		if (user && threadId) {
			threadEintrag = await this.options.threads.hole(kontoId, threadId);
			if (threadEintrag && existsSync(threadEintrag.sessionDatei)) {
				try {
					sessionManager = SessionManager.open(threadEintrag.sessionDatei, undefined, workspace);
				} catch (error) {
					threadEintrag = undefined;
					send({
						type: "notify",
						level: "warning",
						message: `Thread konnte nicht wiederhergestellt werden (${error instanceof Error ? error.message : String(error)}) — neuer Thread gestartet.`,
					});
				}
			} else {
				threadEintrag = undefined;
				send({ type: "notify", level: "warning", message: "Dieser Thread ist nicht mehr verfügbar — neuer Thread gestartet." });
			}
		}

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
			sessionManager,
			modelRuntime,
		});

		await session.bindExtensions({
			uiContext: bridge.ui,
			mode: "rpc",
			onError: (error) => {
				send({ type: "notify", level: "error", message: `Extension-Fehler: ${error.error}` });
			},
		});

		return new HostedSession(session, bridge, workspace, send, this.options, kontoId, modelFallbackMessage, user, threadEintrag);
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
	private readonly options: SessionHostOptions;
	private readonly providers: ProviderStore;
	/** Zugehöriger Thread im Index (nur mit Konto). */
	private threadId: string | undefined;
	private threadErstellt: number;
	private threadTitel = "";
	/** Drossel für Verbindungstests (BYOM): Zeitstempel der letzten Tests. */
	private byomTests: number[] = [];

	constructor(
		session: AgentSession,
		bridge: WebUiBridge,
		workspace: string,
		send: (message: ServerMessage | Record<string, unknown>) => void,
		options: SessionHostOptions,
		kontoId: string,
		modelFallbackMessage?: string,
		user?: WebUser,
		threadEintrag?: ThreadEintrag,
	) {
		this.session = session;
		this.workspace = workspace;
		this.user = user;
		this.kontoId = kontoId;
		this.bridge = bridge;
		this.send = send;
		this.options = options;
		this.providers = options.providers;
		this.threadId = threadEintrag?.id;
		this.threadErstellt = threadEintrag?.erstellt ?? Date.now();
		this.threadTitel = threadEintrag?.titel ?? "";
		this.unsubscribe = session.subscribe((event) => this.forwardEvent(event));

		send({
			type: "ready",
			workspace,
			model: session.model?.name ?? null,
			user: this.user?.login ?? null,
			email: this.user?.email ?? null,
			threadId: this.threadId ?? null,
		});
		// Fortgesetzter Thread: bisherigen Verlauf an die UI schicken.
		if (threadEintrag) this.sendeVerlauf();
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
			case "thread_list":
				await this.threadListe();
				break;
			case "thread_delete":
				await this.threadLoeschen(message.threadId);
				break;
			case "provider_status":
				await this.providerStatus();
				break;
			case "provider_login":
				await this.providerLogin(message.art, message.providerId, message.apiKey);
				break;
			case "provider_logout":
				await this.providerLogout(message.providerId);
				break;
			// "new_thread" und "thread_open" behandelt der Server-Einstieg selbst
			// (Session-Neuaufbau auf derselben Verbindung).
			case "new_thread":
			case "thread_open":
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
				art: p.art ?? "custom",
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

	/* --- Thread-Verlauf (pro Konto) ---------------------------------------- */

	/** Bisheriges Gespräch aus den Session-Nachrichten — Anzeige beim Fortsetzen. */
	private sendeVerlauf(): void {
		const nachrichten: Array<{ rolle: "nutzer" | "agent"; text: string }> = [];
		for (const message of this.session.messages) {
			const rolle = (message as { role?: string }).role;
			if (rolle !== "user" && rolle !== "assistant") continue;
			const text = extractText(message).trim();
			if (!text) continue;
			nachrichten.push({ rolle: rolle === "user" ? "nutzer" : "agent", text });
		}
		this.send({ type: "thread_history", nachrichten });
	}

	/** Nach jedem Agenten-Zug: Thread-Eintrag im Index anlegen/aktualisieren. */
	private async threadSichern(): Promise<void> {
		if (!this.user) return; // Anonym: kein Verlauf.
		const sessionDatei = this.session.sessionFile;
		if (!sessionDatei) return;
		if (!this.threadId) this.threadId = randomUUID();
		if (!this.threadTitel) {
			const erste = this.session.messages.find((m) => (m as { role?: string }).role === "user");
			if (erste) this.threadTitel = extractText(erste).trim().replace(/\s+/g, " ").slice(0, 60);
		}
		try {
			await this.options.threads.sichere(this.kontoId, {
				id: this.threadId,
				titel: this.threadTitel || "Neuer Thread",
				erstellt: this.threadErstellt,
				aktualisiert: Date.now(),
				sessionDatei,
			});
		} catch {
			// Ein Index-Fehler darf das Gespräch nicht abreißen lassen.
		}
	}

	private async threadListe(): Promise<void> {
		if (!this.user) {
			this.send({ type: "threads", threads: [] });
			this.send({ type: "notify", level: "info", message: "Der Thread-Verlauf ist nur mit einem Konto verfügbar." });
			return;
		}
		const liste = await this.options.threads.liste(this.kontoId);
		this.send({
			type: "threads",
			threads: liste.map((eintrag) => ({
				id: eintrag.id,
				titel: eintrag.titel,
				erstellt: eintrag.erstellt,
				aktualisiert: eintrag.aktualisiert,
				aktiv: eintrag.id === this.threadId,
			})),
		});
	}

	private async threadLoeschen(threadId: string): Promise<void> {
		const entfernt = await this.options.threads.loesche(this.kontoId, threadId);
		this.send({
			type: "notify",
			level: entfernt ? "info" : "warning",
			message: entfernt ? "Thread gelöscht." : "Dieser Thread war nicht gespeichert.",
		});
		await this.threadListe();
	}

	/* --- Native Provider-Anmeldung (drei Wege wie in der IDE) ------------ */

	/** Auth-Fähigkeiten eines Pi-Providers defensiv ablesen. */
	private providerFaehigkeiten(provider: unknown): { apiKey: boolean; oauth: boolean } {
		const auth = (provider as { auth?: Record<string, unknown> }).auth ?? {};
		return { apiKey: Boolean(auth.apiKey), oauth: Boolean(auth.oauth) };
	}

	private async providerStatus(): Promise<void> {
		const providers = this.session.modelRuntime.getProviders().map((provider) => {
			const faehig = this.providerFaehigkeiten(provider);
			let angemeldet = false;
			try {
				angemeldet = this.session.modelRuntime.getProviderAuthStatus(provider.id).configured;
			} catch {
				// Status unbekannt — als nicht angemeldet zählen.
			}
			return { id: provider.id, name: provider.name, apiKey: faehig.apiKey, oauth: faehig.oauth, angemeldet };
		});
		this.send({ type: "provider_status", providers });
	}

	private async providerLogin(art: "api" | "oauth", providerId: string, apiKey?: string): Promise<void> {
		const provider = this.session.modelRuntime.getProvider(providerId);
		if (!provider) {
			this.send({ type: "notify", level: "error", message: `Provider „${providerId}“ ist nicht bekannt.` });
			return;
		}
		const faehig = this.providerFaehigkeiten(provider);
		if ((art === "api" && !faehig.apiKey) || (art === "oauth" && !faehig.oauth)) {
			this.send({ type: "notify", level: "error", message: `${provider.name} unterstützt diesen Anmeldeweg nicht.` });
			return;
		}

		const interaction = {
			prompt: async (prompt: { type: string; message: string; placeholder?: string; options?: readonly { id: string }[] }) => {
				// API-Key-Anmeldung mit mitgegebenem Key: Rückfrage direkt beantworten.
				if (art === "api" && apiKey && (prompt.type === "secret" || prompt.type === "text")) return apiKey;
				if (prompt.type === "select" && prompt.options?.length) return prompt.options[0].id;
				const antwort = await this.bridge.ui.input(prompt.message, prompt.placeholder);
				return antwort ?? "";
			},
			notify: (ereignis: Record<string, unknown>) => {
				this.send({ type: "provider_auth_event", providerId, event: ereignis });
			},
		};

		try {
			await this.session.modelRuntime.login(providerId, art === "api" ? "api_key" : "oauth", interaction as never);
			this.send({ type: "notify", level: "info", message: `${provider.name} ist angemeldet.` });
			await this.modellDesProvidersAktivieren(providerId);
			await this.providerStatus();
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: `Anmeldung nicht abgeschlossen: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private async providerLogout(providerId: string): Promise<void> {
		try {
			await this.session.modelRuntime.logout(providerId);
			this.send({ type: "notify", level: "info", message: "Provider abgemeldet." });
		} catch (error) {
			this.send({
				type: "notify",
				level: "error",
				message: `Abmeldung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
		await this.providerStatus();
	}

	/** Das erste verfügbare Modell des Providers aktiv setzen (wie in der IDE). */
	private async modellDesProvidersAktivieren(providerId: string): Promise<void> {
		const aktuell = this.session.model as unknown as { provider?: string } | undefined;
		if (aktuell?.provider === providerId) return;
		const modelle = await this.session.modelRuntime.getAvailable(providerId).catch(() => [] as const);
		const ziel = modelle[0];
		if (!ziel) {
			this.send({
				type: "notify",
				level: "warning",
				message: `Für ${providerId} sind keine Modelle im Katalog — Modell bitte manuell wählen.`,
			});
			return;
		}
		await this.session.setModel(ziel);
		this.send({ type: "model_changed", model: this.session.model?.name ?? ziel.id });
		this.sendeZustand();
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
				void this.threadSichern();
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
		threads: new ThreadStore(join(home, "web-threads.json")),
		credentialsDir: join(home, "web-credentials"),
	};
}
