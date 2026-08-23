/**
 * UI-Brücke für die IDE — ExtensionUIContext über ACP.
 *
 * Gleiche Rolle wie web/server/ui-bridge.ts: Solange die Brücke gesetzt ist,
 * meldet der ExtensionRunner `hasUI === true` und der Diff-Guard läuft —
 * seine Rückfrage landet aber nicht im Browser, sondern als
 * `session/request_permission` in Zed, das daraus einen nativen Dialog
 * (Übernehmen / Verwerfen) macht. Auswahl und Eingabe kennt ACP nicht —
 * sie werden bewusst abgelehnt, statt still etwas zu raten.
 */

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AcpVerbindung } from "./acp.ts";

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

export class IdeUiBridge {
	readonly ui: ExtensionUIContext;
	private geschlossen = false;
	private readonly verbindung: AcpVerbindung;
	private readonly sessionId: string;

	constructor(verbindung: AcpVerbindung, sessionId: string) {
		this.verbindung = verbindung;
		this.sessionId = sessionId;
		this.ui = this.bauen();
	}

	schliessen(): void {
		this.geschlossen = true;
	}

	private async erlaubnisAnfragen(frage: string, jaText: string, neinText: string): Promise<boolean> {
		if (this.geschlossen) return false;
		try {
			const antwort = (await this.verbindung.anfragen("session/request_permission", {
				sessionId: this.sessionId,
				options: [
					{ optionId: "ja", name: jaText, kind: "allow_once" },
					{ optionId: "nein", name: neinText, kind: "reject_once" },
				],
				_meta: { frage },
			})) as { outcome?: { outcome?: string; optionId?: string } } | null;
			return antwort?.outcome?.outcome === "selected" && antwort.outcome.optionId === "ja";
		} catch {
			return false; // Kein Dialog möglich → lieber ablehnen als durchwinken.
		}
	}

	private bauen(): ExtensionUIContext {
		const verbindung = this.verbindung;
		const sessionId = this.sessionId;

		const mitteilung = (level: "info" | "warning" | "error", nachricht: string) => {
			// ACP hat keinen Notify-Kanal — die Meldung geht als Textblock in den Chat.
			const praefix = level === "error" ? "**Hinweis:** " : "";
			verbindung.benachrichtigen("session/update", {
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `${praefix}${nachricht}\n` },
				},
			});
		};

		return {
			confirm: async (titel: string, nachricht: string) =>
				this.erlaubnisAnfragen(`${titel}\n${nachricht}`, "Übernehmen", "Verwerfen"),
			select: async () => {
				mitteilung("warning", "Auswahl-Dialoge gibt es in der IDE nicht — bitte im Chat antworten.");
				return undefined;
			},
			input: async () => {
				mitteilung("warning", "Eingabe-Dialoge gibt es in der IDE nicht — bitte im Chat antworten.");
				return undefined;
			},
			notify: (nachricht: string, typ: "info" | "warning" | "error" = "info") => mitteilung(typ, nachricht),
			setStatus: () => {},
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
			custom: () => Promise.reject(new Error("Benutzerdefinierte TUI-Dialoge gibt es in der IDE nicht.")),
			editor: () => Promise.reject(new Error("Der Editor-Dialog gibt es in der IDE nicht.")),
		} as unknown as ExtensionUIContext;
	}
}
