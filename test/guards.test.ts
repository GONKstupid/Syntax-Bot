/**
 * Tests für die beiden Leitplanken aus der Spezifikation:
 * Diff-First (nie ungefragt schreiben) und die Bestätigungspflicht bei
 * Paket-Installationen.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import coreExtension from "../extensions/core/index.ts";
import { createStub, type Stub } from "./stub-pi.ts";

let workDir: string;

before(() => {
	workDir = mkdtempSync(join(tmpdir(), "syntax-bot-test-"));
	writeFileSync(join(workDir, "beispiel.txt"), "eins\nzwei\ndrei\n");
});

after(() => {
	rmSync(workDir, { recursive: true, force: true });
});

function loadCore(options: { hasUI?: boolean } = {}): Stub {
	const stub = createStub({ cwd: workDir, hasUI: options.hasUI });
	coreExtension(stub.pi);
	return stub;
}

describe("Diff-Guard", () => {
	it("zeigt den Diff einer edit-Änderung und lässt sie nach Zustimmung durch", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(true);

		const verdict = await stub.emitFirst("tool_call", {
			toolName: "edit",
			toolCallId: "t1",
			input: { path: "beispiel.txt", edits: [{ oldText: "zwei", newText: "ZWEI" }] },
		});

		assert.equal(verdict, undefined);
		assert.equal(stub.confirmPrompts.length, 1);
		assert.match(stub.confirmPrompts[0].title, /beispiel\.txt/);
		assert.match(stub.confirmPrompts[0].body, /ZWEI/);
	});

	it("blockt die Änderung, wenn der Nutzer ablehnt", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(false);

		const verdict = await stub.emitFirst("tool_call", {
			toolName: "edit",
			toolCallId: "t1",
			input: { path: "beispiel.txt", edits: [{ oldText: "zwei", newText: "ZWEI" }] },
		});

		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /abgelehnt/);
	});

	it("fragt auch beim Überschreiben einer bestehenden Datei", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(true);

		await stub.emitFirst("tool_call", {
			toolName: "write",
			toolCallId: "t1",
			input: { path: "beispiel.txt", content: "komplett anders\n" },
		});

		assert.match(stub.confirmPrompts[0].title, /überschreiben/i);
	});

	it("markiert eine noch nicht existierende Datei als Neuanlage", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(true);

		await stub.emitFirst("tool_call", {
			toolName: "write",
			toolCallId: "t1",
			input: { path: "neu.txt", content: "hallo\n" },
		});

		assert.match(stub.confirmPrompts[0].title, /Neue Datei/);
	});

	it("lässt lesende Werkzeuge unangetastet", async () => {
		const stub = loadCore();
		const verdict = await stub.emitFirst("tool_call", {
			toolName: "read",
			toolCallId: "t1",
			input: { path: "beispiel.txt" },
		});

		assert.equal(verdict, undefined);
		assert.equal(stub.confirmPrompts.length, 0);
	});

	it("blockt Schreibvorgänge ohne Oberfläche, statt sie durchzuwinken", async () => {
		const stub = loadCore({ hasUI: false });
		const verdict = await stub.emitFirst("tool_call", {
			toolName: "write",
			toolCallId: "t1",
			input: { path: "beispiel.txt", content: "x" },
		});

		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /auto-apply/);
	});

	it("überspringt die Rückfrage bei --auto-apply", async () => {
		const stub = loadCore();
		stub.pi.setFlag("auto-apply", true);

		const verdict = await stub.emitFirst("tool_call", {
			toolName: "write",
			toolCallId: "t1",
			input: { path: "beispiel.txt", content: "x" },
		});

		assert.equal(verdict, undefined);
		assert.equal(stub.confirmPrompts.length, 0);
	});
});

describe("Meta-Werkzeug für Pi-Pakete", () => {
	async function runTool(stub: Stub, params: Record<string, unknown>) {
		const tool = stub.tools.get("install_pi_package");
		assert.ok(tool, "install_pi_package fehlt");
		return tool.execute("call-1", params, undefined, undefined, stub.ctx);
	}

	it("installiert erst nach ausdrücklicher Bestätigung", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(true);
		stub.setExecResult({ stdout: "installiert", code: 0 });

		const result = await runTool(stub, { action: "install", source: "npm:pi-web-access" });

		assert.equal(stub.confirmPrompts.length, 1);
		assert.match(stub.confirmPrompts[0].body, /pi install npm:pi-web-access/);
		assert.equal(stub.execCalls.length, 1);
		assert.equal(result.details.confirmed, true);
	});

	it("führt nichts aus, wenn der Nutzer ablehnt", async () => {
		const stub = loadCore();
		stub.answerConfirmsWith(false);

		const result = await runTool(stub, { action: "install", source: "npm:pi-web-access" });

		assert.equal(stub.execCalls.length, 0);
		assert.equal(result.details.confirmed, false);
		assert.match(result.content[0].text, /abgelehnt/);
	});

	it("weist unplausible Quellen ab, ohne zu fragen", async () => {
		const stub = loadCore();
		await assert.rejects(() => runTool(stub, { action: "install", source: "mach mal was" }), /Paketquelle/);
		assert.equal(stub.confirmPrompts.length, 0);
		assert.equal(stub.execCalls.length, 0);
	});

	it("installiert nicht ohne Oberfläche", async () => {
		const stub = loadCore({ hasUI: false });
		await assert.rejects(() => runTool(stub, { action: "install", source: "npm:pi-web-access" }), /Bestätigung/);
		assert.equal(stub.execCalls.length, 0);
	});

	it("listet Pakete ohne Rückfrage auf", async () => {
		const stub = loadCore();
		stub.setExecResult({ stdout: "npm:pi-web-access", code: 0 });

		const result = await runTool(stub, { action: "list" });

		assert.equal(stub.confirmPrompts.length, 0);
		assert.equal(stub.execCalls.length, 1);
		assert.match(result.content[0].text, /pi-web-access/);
	});
});
