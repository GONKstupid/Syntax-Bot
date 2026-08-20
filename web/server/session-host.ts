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
import { mkdir } from "node:fs/promises";
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
import { WebUiBridge, type ServerMessage } from "./ui-bridge.ts";

export interface SessionHostOptions {
	/** Konfigurationsverzeichnis der isolierten Instanz (~/.syntax-bot/agent). */
	agentDir: string;
	/** Wurzel, unter der pro Verbindung ein Arbeitsbereich angelegt wird. */
	workspacesDir: string;
	/** Freies bash erlauben (SYNTAX_BOT_WEB_BASH=1). */
	allowBash: boolean;
}

/** Nachrichten Browser → Server. */
export type ClientMessage =
	| { type: "user_message"; text: string }
	| { type: "ui_response"; requestId: number; value: unknown }
	| { type: "interrupt" }
	| { type: "byom_test"; baseUrl: string; apiKey: string }
	| { type: "byom_save"; config: unknown };

/** Textanteil einer Assistenten-Nachricht (Denkblöcke und Werkzeugaufrufe ausgeblendet). */
function extractText(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text")
		.map((block) => block.text)
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

		return new HostedSession(session, bridge, workspace, send, modelFallbackMessage, user);
	}
}

export class HostedSession {
	private readonly unsubscribe: () => void;
	private readonly bridge: WebUiBridge;
	private readonly send: (message: ServerMessage | Record<string, unknown>) => void;
	readonly session: AgentSession;
	readonly workspace: string;
	readonly user?: WebUser;
	/** Drossel für Verbindungstests (BYOM): Zeitstempel der letzten Tests. */
	private byomTests: number[] = [];

	constructor(
		session: AgentSession,
		bridge: WebUiBridge,
		workspace: string,
		send: (message: ServerMessage | Record<string, unknown>) => void,
		modelFallbackMessage?: string,
		user?: WebUser,
	) {
		this.session = session;
		this.workspace = workspace;
		this.user = user;
		this.bridge = bridge;
		this.send = send;
		this.unsubscribe = session.subscribe((event) => this.forwardEvent(event));

		send({ type: "ready", workspace, model: session.model?.name ?? null, user: this.user?.login ?? null });
		if (!session.model) {
			send({
				type: "notify",
				level: "warning",
				message:
					"Es ist noch kein Modell eingerichtet. Öffne oben den Knopf »Modell« und verbinde " +
					"deinen eigenen OpenAI-kompatiblen Endpunkt (BYOM).",
			});
		} else if (modelFallbackMessage) {
			send({ type: "notify", level: "warning", message: modelFallbackMessage });
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
			const config = validateByomConfig(rawConfig);
			await applyByomToSession(this.session, config);
			this.send({
				type: "notify",
				level: "info",
				message: `Modell verbunden: ${config.modelId} (${config.displayName})`,
			});
			this.send({ type: "model_changed", model: this.session.model?.name ?? config.modelId });
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
				break;
			case "message_start":
				if ((event.message as { role?: string })?.role === "assistant") {
					this.send({ type: "assistant_start" });
				}
				break;
			case "message_update":
				if ((event.message as { role?: string })?.role === "assistant") {
					this.send({ type: "assistant_update", text: extractText(event.message) });
				}
				break;
			case "message_end":
				if ((event.message as { role?: string })?.role === "assistant") {
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
	};
}
