/**
 * Tests für die Modus-Grenzen.
 *
 * Der Kern des Versprechens von Syntax Bot ist: Ein Modus kann nicht mehr, als
 * er darf. Diese Tests laden die echten Extensions gegen einen Stub der
 * Pi-Schnittstelle und prüfen, was durchkommt und was blockiert wird.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import cleanupExtension from "../extensions/cleanup/index.ts";
import codeFixExtension from "../extensions/code-fix/index.ts";
import coreExtension from "../extensions/core/index.ts";
import { deactivateMode } from "../extensions/shared/mode-core.ts";
import syntaxFixExtension from "../extensions/syntax-fix/index.ts";
import { createStub, type Stub } from "./stub-pi.ts";

const BASELINE_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"];

function loadAll(): Stub {
	const stub = createStub({ tools: BASELINE_TOOLS });
	coreExtension(stub.pi);
	syntaxFixExtension(stub.pi);
	codeFixExtension(stub.pi);
	cleanupExtension(stub.pi);
	return stub;
}

/** Aktiviert einen Modus über seinen Slash-Command. */
async function activate(stub: Stub, command: string, args = ""): Promise<void> {
	const entry = stub.commands.get(command);
	assert.ok(entry, `Command /${command} ist nicht registriert`);
	await entry.handler(args, stub.ctx);
}

/** Simuliert einen Werkzeugaufruf und gibt die Blockade-Entscheidung zurück. */
async function callTool(stub: Stub, toolName: string, input: Record<string, unknown>) {
	return stub.emitFirst("tool_call", { toolName, toolCallId: "t1", input });
}

let stub: Stub;

beforeEach(() => {
	stub = loadAll();
	// Der Modus-Zustand liegt global — vor jedem Test zurücksetzen.
	deactivateMode(stub.pi, stub.ctx);
});

describe("Registrierung", () => {
	it("registriert die drei Modi und die Kern-Commands", () => {
		for (const name of ["syntax-fix", "code-fix", "cleanup", "modus", "modus-aus"]) {
			assert.ok(stub.commands.has(name), `/${name} fehlt`);
		}
	});

	it("registriert das Meta-Werkzeug für Pi-Pakete", () => {
		assert.ok(stub.tools.has("install_pi_package"));
	});
});

describe("Syntax-Fix-Modus", () => {
	it("schaltet write und bash ab", async () => {
		await activate(stub, "syntax-fix");
		const active = stub.getActiveTools();
		assert.deepEqual(active.sort(), ["edit", "find", "grep", "ls", "read"]);
	});

	it("blockt bash", async () => {
		await activate(stub, "syntax-fix");
		const verdict = await callTool(stub, "bash", { command: "ls" });
		assert.equal(verdict?.block, true);
	});

	it("blockt write", async () => {
		await activate(stub, "syntax-fix");
		const verdict = await callTool(stub, "write", { path: "a.txt", content: "x" });
		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /nicht erlaubt/);
	});

	it("lässt edit durch", async () => {
		await activate(stub, "syntax-fix");
		const verdict = await callTool(stub, "edit", {
			path: "a.txt",
			edits: [{ oldText: "retrun", newText: "return" }],
		});
		assert.equal(verdict, undefined);
	});

	it("injiziert sein Prompt-Fragment", async () => {
		await activate(stub, "syntax-fix");
		const result = await stub.emitFirst("before_agent_start", { prompt: "x", systemPrompt: "BASIS" });
		assert.match(result.systemPrompt, /^BASIS/);
		assert.match(result.systemPrompt, /Modus: Syntax Fix/);
		assert.match(result.systemPrompt, /Verboten/);
	});

	it("gibt einen mitgegebenen Auftrag direkt weiter", async () => {
		await activate(stub, "syntax-fix", "@src/parser.c");
		assert.deepEqual(stub.sentUserMessages, ["@src/parser.c"]);
	});
});

describe("Cleanup-Modus", () => {
	it("erlaubt Formatter, blockt alles andere", async () => {
		await activate(stub, "cleanup");

		assert.equal(await callTool(stub, "bash", { command: "prettier --write a.ts" }), undefined);

		const verdict = await callTool(stub, "bash", { command: "npm test" });
		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /Allowlist/);
	});

	it("schaltet write ab", async () => {
		await activate(stub, "cleanup");
		assert.equal(stub.getActiveTools().includes("write"), false);
	});

	it("liefert den Cleanup-Prompt ohne Stilquellen-Dateiverweis", async () => {
		await activate(stub, "cleanup");
		const result = await stub.emitFirst("before_agent_start", { prompt: "x", systemPrompt: "BASIS" });
		assert.doesNotMatch(result.systemPrompt, /linux-kernel-coding-style\.rst/);
		assert.doesNotMatch(result.systemPrompt, /\{\{STYLE_PATH\}\}/);
	});
});

describe("Code-Fix-Modus", () => {
	it("erlaubt Tests und Schreibzugriff", async () => {
		await activate(stub, "code-fix");
		assert.equal(await callTool(stub, "bash", { command: "npm test" }), undefined);
		assert.equal(await callTool(stub, "write", { path: "a.ts", content: "x" }), undefined);
	});
});

describe("Moduswechsel", () => {
	it("hält immer nur einen Modus aktiv", async () => {
		await activate(stub, "cleanup");
		await activate(stub, "syntax-fix");

		// Der Cleanup-Handler darf jetzt nicht mehr greifen: bash ist im
		// Syntax-Fix-Modus gesperrt, nicht bloß auf Formatter beschränkt.
		const verdict = await callTool(stub, "bash", { command: "prettier --write a.ts" });
		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /Syntax Fix/);
	});

	it("stellt nach /modus-aus die ursprünglichen Werkzeuge wieder her", async () => {
		await activate(stub, "cleanup");
		await activate(stub, "syntax-fix");
		await activate(stub, "modus-aus");

		assert.deepEqual(stub.getActiveTools().sort(), [...BASELINE_TOOLS].sort());
		assert.equal(await callTool(stub, "bash", { command: "npm test" }), undefined);
	});

	it("stellt den Modus in einer fortgesetzten Session wieder her", async () => {
		await activate(stub, "cleanup");
		// Historie so festhalten, wie sie beim Beenden des Prozesses aussähe.
		const history = [...stub.entries];
		deactivateMode(stub.pi, stub.ctx);

		// Neue Extension-Instanz auf derselben Session-Historie.
		const resumed = createStub({ tools: BASELINE_TOOLS });
		for (const entry of history) resumed.entries.push(entry);
		coreExtension(resumed.pi);
		syntaxFixExtension(resumed.pi);
		codeFixExtension(resumed.pi);
		cleanupExtension(resumed.pi);

		await resumed.emit("session_start", {});
		assert.equal(resumed.getActiveTools().includes("write"), false);
		assert.equal(resumed.getActiveTools().includes("bash"), true);

		deactivateMode(resumed.pi, resumed.ctx);
	});
});

describe("Parallele Sessions", () => {
	it("hält die Modi getrennter Sessions in einem Prozess auseinander", async () => {
		// Zwei „Sessions" im selben Prozess — der Normalfall auf dem Web-Server.
		const a = loadAll();
		const b = loadAll();

		await activate(a, "syntax-fix");
		await activate(b, "cleanup");

		// Session A (Syntax Fix): bash ist komplett blockiert …
		const verdictA = await callTool(a, "bash", { command: "prettier --write a.ts" });
		assert.equal(verdictA?.block, true);
		assert.match(verdictA.reason, /Syntax Fix/);

		// … während Session B (Cleanup) davon unberührt weiterläuft.
		assert.equal(await callTool(b, "bash", { command: "prettier --write a.ts" }), undefined);
		assert.equal(b.getActiveTools().includes("write"), false);

		// A beenden stellt nur A's Werkzeuge wieder her, B bleibt im Cleanup-Modus.
		await activate(a, "modus-aus");
		assert.deepEqual(a.getActiveTools().sort(), [...BASELINE_TOOLS].sort());
		const stillCleanup = await callTool(b, "bash", { command: "npm test" });
		assert.equal(stillCleanup?.block, true);
		assert.match(stillCleanup.reason, /Cleanup/);

		await activate(b, "modus-aus");
	});
});
