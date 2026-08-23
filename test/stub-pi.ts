/**
 * Minimaler Nachbau der Pi-Extension-Schnittstelle für die Tests.
 *
 * Die Modi verlassen sich auf sehr wenig von Pi: Ereignisse, Werkzeugliste,
 * Session-Einträge und ein paar Dialoge. Genau das bildet dieser Stub nach —
 * damit lassen sich die Modus-Grenzen prüfen, ohne ein Modell zu befragen.
 */

export interface RecordedCommand {
	description: string;
	handler: (args: string, ctx: any) => Promise<void> | void;
}

export interface RecordedTool {
	name: string;
	execute: (...args: any[]) => Promise<any>;
	[key: string]: unknown;
}

export interface StubUiScript {
	/** Antworten für ctx.ui.confirm, der Reihe nach. */
	confirm?: boolean[];
}

export function createStub(options: { cwd?: string; hasUI?: boolean; tools?: string[] } = {}) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<any>>>();
	const commands = new Map<string, RecordedCommand>();
	const tools = new Map<string, RecordedTool>();
	const flags = new Map<string, unknown>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const notifications: string[] = [];
	const confirmPrompts: Array<{ title: string; body: string }> = [];
	const sentUserMessages: string[] = [];

	let activeTools = options.tools ?? ["read", "grep", "find", "ls", "edit", "write", "bash"];
	const confirmAnswers: boolean[] = [];
	let execResult = { stdout: "", stderr: "", code: 0, killed: false };

	const pi = {
		on(event: string, handler: (event: any, ctx: any) => Promise<any>) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string, command: RecordedCommand) {
			commands.set(name, command);
		},
		registerTool(tool: RecordedTool) {
			tools.set(tool.name, tool);
		},
		registerFlag(name: string, options: { default?: unknown }) {
			flags.set(name, options.default);
		},
		registerShortcut() {},
		getFlag(name: string) {
			return flags.get(name);
		},
		setFlag(name: string, value: unknown) {
			flags.set(name, value);
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendUserMessage(content: string) {
			sentUserMessages.push(content);
		},
		async exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			return execResult;
		},
	};

	const ctx = {
		hasUI: options.hasUI ?? true,
		mode: "tui",
		cwd: options.cwd ?? process.cwd(),
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify(message: string) {
				notifications.push(message);
			},
			setStatus() {},
			setWidget() {},
			async confirm(title: string, body: string) {
				confirmPrompts.push({ title, body });
				return confirmAnswers.length > 0 ? (confirmAnswers.shift() as boolean) : true;
			},
		},
		sessionManager: {
			getEntries: () => entries,
			getBranch: () => entries,
		},
	};

	/** Feuert ein Ereignis an alle Abonnenten und sammelt die Rückgaben ein. */
	async function emit(event: string, payload: any): Promise<any[]> {
		const results: any[] = [];
		for (const handler of handlers.get(event) ?? []) {
			results.push(await handler(payload, ctx));
		}
		return results;
	}

	/** Erste nicht-leere Rückgabe eines Ereignisses. */
	async function emitFirst(event: string, payload: any): Promise<any> {
		return (await emit(event, payload)).find((result) => result !== undefined);
	}

	return {
		pi: pi as any,
		ctx: ctx as any,
		emit,
		emitFirst,
		commands,
		tools,
		entries,
		execCalls,
		notifications,
		confirmPrompts,
		sentUserMessages,
		getActiveTools: () => [...activeTools],
		answerConfirmsWith(...answers: boolean[]) {
			confirmAnswers.push(...answers);
		},
		setExecResult(result: Partial<typeof execResult>) {
			execResult = { ...execResult, ...result };
		},
	};
}

export type Stub = ReturnType<typeof createStub>;
