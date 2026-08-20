/**
 * Gemeinsamer Kern für die Syntax-Bot-Modi.
 *
 * Ein Modus ist keine eigene Codebasis, sondern nur eine Einschränkung auf dem
 * gemeinsamen Agenten: ein System-Prompt-Fragment plus eine Liste erlaubter
 * Werkzeuge. Jeder Modus bleibt eine eigene Pi-Extension.
 *
 * Zustand: Die Modus-Definitionen sind statisch und liegen prozess-global. Der
 * *aktive* Modus liegt pro Session (Schlüssel: der SessionManager), damit sich
 * parallele Sessions in einem Prozess — etwa auf dem Web-Server — nicht
 * gegenseitig überschreiben. Die Modus-Extensions einer Session sehen denselben
 * SessionManager und teilen sich so genau diesen einen Zustand.
 */

import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type BashPolicy, checkBashPolicy } from "./bash-policy.ts";

export interface ModeDefinition {
	/** Stabile ID, dient auch als Schlüssel in der Session-Persistenz. */
	id: string;
	/** Slash-Command ohne führenden Schrägstrich. */
	command: string;
	/** Anzeigename, z. B. "Syntax Fix". */
	label: string;
	/** Kurzbeschreibung für die Command-Liste. */
	description: string;
	/** Satz, der beim Aktivieren angezeigt wird. */
	greeting: string;
	/** Kürzel für die Fußzeile. */
	badge: string;
	/** Werkzeuge, die in diesem Modus erlaubt sind. */
	tools: string[];
	/** Regeln für das bash-Werkzeug. */
	bash: BashPolicy;
	/** Datei mit dem System-Prompt-Fragment (Markdown). */
	promptPath: string;
	/** Platzhalter der Form `{{NAME}}`, die im Prompt ersetzt werden. */
	promptVariables?: Record<string, string>;
}

/**
 * Werkzeuge, die in jedem Modus verfügbar bleiben. Sie haben eine eigene
 * Rückfrage und dürfen den Code nicht anfassen.
 */
const ALWAYS_ALLOWED_TOOLS = ["install_pi_package"];

/** customType der Session-Einträge, in denen der aktive Modus überdauert. */
const PERSIST_TYPE = "syntax-bot-mode";

const STATUS_KEY = "syntax-bot-mode";

interface SessionModeState {
	activeModeId: string | null;
	/** Werkzeug-Auswahl, wie sie vor dem ersten Moduswechsel aktiv war. */
	toolsBeforeMode: string[] | null;
}

interface PersistedModeState {
	activeModeId: string | null;
	toolsBeforeMode: string[] | null;
}

/** Statisch und für alle Sessions identisch — deshalb prozess-global. */
const modeRegistry = new Map<string, ModeDefinition>();

/** Aktiver Modus und Werkzeug-Baseline, getrennt nach Session. */
const sessionStates = new WeakMap<object, SessionModeState>();

/** Rückfall, falls ein Aufruf ohne erkennbare Session hereinkommt. */
const fallbackState: SessionModeState = { activeModeId: null, toolsBeforeMode: null };

function getSessionState(ctx: ExtensionContext | undefined): SessionModeState {
	const key: unknown = ctx?.sessionManager;
	if (!key || (typeof key !== "object" && typeof key !== "function")) return fallbackState;

	let state = sessionStates.get(key as object);
	if (!state) {
		state = { activeModeId: null, toolsBeforeMode: null };
		sessionStates.set(key as object, state);
	}
	return state;
}

export function getActiveMode(ctx: ExtensionContext): ModeDefinition | undefined {
	const state = getSessionState(ctx);
	return state.activeModeId ? modeRegistry.get(state.activeModeId) : undefined;
}

export function listModes(): ModeDefinition[] {
	return [...modeRegistry.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
}

/** Liest das Prompt-Fragment bei jedem Zug neu, damit Änderungen sofort greifen. */
function loadPrompt(mode: ModeDefinition): string {
	let text: string;
	try {
		text = readFileSync(mode.promptPath, "utf8");
	} catch (error) {
		return `[Modus ${mode.label}] Prompt-Datei ${mode.promptPath} konnte nicht gelesen werden: ${error}`;
	}

	for (const [name, value] of Object.entries(mode.promptVariables ?? {})) {
		text = text.replaceAll(`{{${name}}}`, value);
	}
	return text.trim();
}

function resolveTools(mode: ModeDefinition, baseline: string[]): string[] {
	const carriedOver = ALWAYS_ALLOWED_TOOLS.filter((name) => baseline.includes(name));
	return [...new Set([...mode.tools, ...carriedOver])];
}

function isToolAllowed(mode: ModeDefinition, toolName: string): boolean {
	return mode.tools.includes(toolName) || ALWAYS_ALLOWED_TOOLS.includes(toolName);
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const mode = getActiveMode(ctx);
	ctx.ui.setStatus(STATUS_KEY, mode ? ctx.ui.theme.fg("accent", `● ${mode.badge}`) : undefined);
}

function persist(pi: ExtensionAPI, state: SessionModeState): void {
	const data: PersistedModeState = {
		activeModeId: state.activeModeId,
		toolsBeforeMode: state.toolsBeforeMode,
	};
	pi.appendEntry(PERSIST_TYPE, data);
}

/** Letzter persistierter Modus-Zustand der Session, falls vorhanden. */
function readPersisted(ctx: ExtensionContext): PersistedModeState | undefined {
	const entries = ctx.sessionManager.getEntries() as Array<{
		type: string;
		customType?: string;
		data?: PersistedModeState;
	}>;

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "custom" && entry.customType === PERSIST_TYPE) return entry.data;
	}
	return undefined;
}

interface ActivateOptions {
	/** Beim Wiederherstellen einer Session: keine Meldung, kein neuer Eintrag. */
	silent?: boolean;
}

export function activateMode(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	mode: ModeDefinition,
	options: ActivateOptions = {},
): void {
	const state = getSessionState(ctx);

	// Nur beim ersten Moduswechsel merken — sonst würde ein Wechsel von Modus A
	// nach B die eingeschränkte Werkzeugliste von A als "normal" festschreiben.
	if (state.toolsBeforeMode === null) state.toolsBeforeMode = pi.getActiveTools();

	state.activeModeId = mode.id;
	pi.setActiveTools(resolveTools(mode, state.toolsBeforeMode));
	updateStatus(ctx);

	if (options.silent) return;

	persist(pi, state);
	if (ctx.hasUI) ctx.ui.notify(`${mode.label}-Modus aktiv. ${mode.greeting}`, "info");
}

export function deactivateMode(pi: ExtensionAPI, ctx: ExtensionContext): ModeDefinition | undefined {
	const state = getSessionState(ctx);
	const previous = getActiveMode(ctx);
	if (!previous) return undefined;

	if (state.toolsBeforeMode) pi.setActiveTools(state.toolsBeforeMode);
	state.activeModeId = null;
	state.toolsBeforeMode = null;

	updateStatus(ctx);
	persist(pi, state);
	return previous;
}

/**
 * Verdrahtet einen Modus vollständig: Slash-Command, Prompt-Injektion,
 * Werkzeug-Grenzen und Wiederherstellung nach einem Neustart.
 *
 * Alle Handler prüfen zuerst, ob genau dieser Modus aktiv ist. Dadurch bleibt
 * es folgenlos, dass jede Modus-Extension dieselben Ereignisse abonniert.
 */
export function registerMode(pi: ExtensionAPI, mode: ModeDefinition): void {
	modeRegistry.set(mode.id, mode);

	pi.registerCommand(mode.command, {
		description: mode.description,
		handler: async (args, ctx) => {
			activateMode(pi, ctx, mode);

			// "/cleanup src/parser.c" soll direkt losarbeiten, statt nachzufragen.
			const task = args?.trim();
			if (task) pi.sendUserMessage(task);
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (getSessionState(ctx).activeModeId !== mode.id) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${loadPrompt(mode)}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (getSessionState(ctx).activeModeId !== mode.id) return;

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown }).command ?? "");
			const verdict = checkBashPolicy(mode.bash, command);
			if (!verdict.allowed) {
				return {
					block: true,
					reason: `${mode.label}-Modus: ${verdict.reason} Mit /modus-aus verlässt du den Modus.`,
				};
			}
			return;
		}

		if (!isToolAllowed(mode, event.toolName)) {
			return {
				block: true,
				reason:
					`${mode.label}-Modus: Das Werkzeug "${event.toolName}" ist hier nicht erlaubt. ` +
					`Erlaubt sind: ${mode.tools.join(", ")}. Mit /modus-aus verlässt du den Modus.`,
			};
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const persisted = readPersisted(ctx);
		if (!persisted || persisted.activeModeId !== mode.id) return;

		getSessionState(ctx).toolsBeforeMode = persisted.toolsBeforeMode ?? pi.getActiveTools();
		activateMode(pi, ctx, mode, { silent: true });
	});
}
