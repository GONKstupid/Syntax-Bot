/**
 * UI-Bridge — das Gesicht der Session zum Browser.
 *
 * Die Syntax-Bot-Extensions reden über `ctx.ui` mit dem Menschen: Der
 * Diff-Guard ruft `confirm()`, die Modi `notify()` und `setStatus()`. Im
 * Browser gibt es kein TUI, also übersetzt diese Brücke jeden Aufruf in eine
 * WebSocket-Nachricht und wartet auf die Antwort. Solange die Brücke gesetzt
 * ist, meldet der ExtensionRunner `hasUI === true` — der Diff-Guard läuft
 * damit unverändert, nur landet der Dialog jetzt im Browser.
 */

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

/** Nachrichten Server → Browser. */
export type ServerMessage =
	| { type: "ui_request"; requestId: number; kind: "confirm"; title: string; body: string }
	| { type: "ui_request"; requestId: number; kind: "select"; title: string; options: string[] }
	| { type: "ui_request"; requestId: number; kind: "input"; title: string; placeholder?: string }
	| { type: "notify"; level: "info" | "warning" | "error"; message: string }
	| { type: "status"; key: string; text?: string };

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

/** Der Browser bekommt Rohtext — Farben und Akzente sind dort CSS-Sache. */
const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

export class WebUiBridge {
	private nextRequestId = 1;
	private pending = new Map<number, PendingRequest>();
	private closed = false;
	private readonly send: (message: ServerMessage) => void;

	constructor(send: (message: ServerMessage) => void) {
		this.send = send;
		this.ui = this.buildUi();
	}

	/** Das Interface, das der ExtensionRunner per setUIContext bekommt. */
	readonly ui: ExtensionUIContext;

	/** Antwort des Browsers auf eine ui_request. */
	handleResponse(requestId: number, value: unknown): void {
		const request = this.pending.get(requestId);
		if (!request) return;
		this.pending.delete(requestId);
		request.resolve(value);
	}

	/** Verbindung weg — alle wartenden Dialoge platzen lassen, statt zu hängen. */
	close(): void {
		this.closed = true;
		for (const request of this.pending.values()) {
			request.reject(new Error("Die Verbindung zum Browser wurde geschlossen."));
		}
		this.pending.clear();
	}

	private request(kind: "confirm" | "select" | "input", payload: Record<string, unknown>): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("Die Verbindung zum Browser wurde geschlossen."));

		const requestId = this.nextRequestId++;
		return new Promise((resolvePromise, rejectPromise) => {
			this.pending.set(requestId, { resolve: resolvePromise, reject: rejectPromise });
			this.send({ type: "ui_request", requestId, kind, ...payload } as ServerMessage);
		});
	}

	private buildUi(): ExtensionUIContext {
		const send = this.send;
		return {
			// --- Die drei echten Dialoge --------------------------------------
			confirm: async (title: string, message: string) =>
				(await this.request("confirm", { title, body: message })) === true,
			select: async (title: string, options: string[]) => {
				const answer = await this.request("select", { title, options });
				return typeof answer === "string" ? answer : undefined;
			},
			input: async (title: string, placeholder?: string) => {
				const answer = await this.request("input", { title, placeholder });
				return typeof answer === "string" ? answer : undefined;
			},

			// --- Feuer-und-vergiss-Nachrichten ---------------------------------
			notify: (message: string, type: "info" | "warning" | "error" = "info") =>
				send({ type: "notify", level: type, message }),
			setStatus: (key: string, text?: string) => send({ type: "status", key, text }),

			// --- TUI-Rest: im Web bedeutungslos, aber harmlos aufzurufen --------
			theme: plainTheme,
			onTerminalInput: () => () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Themes gibt es nur im TUI." }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},

			// Komplexe TUI-Komponenten können wir im Browser nicht abbilden.
			custom: () => Promise.reject(new Error("Benutzerdefinierte TUI-Dialoge gibt es im Web nicht.")),
			editor: () => Promise.reject(new Error("Der Editor-Dialog gibt es im Web nicht.")),
		} as unknown as ExtensionUIContext;
	}
}
