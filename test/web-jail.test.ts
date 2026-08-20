/**
 * Tests für das Web-Jail: Kein Werkzeugaufruf darf den Arbeitsbereich einer
 * Web-Session verlassen, und bash ist ohne ausdrückliches Opt-in abgeschaltet.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createJailExtension, isInsideRoot } from "../web/server/jail-extension.ts";
import { createStub, type Stub } from "./stub-pi.ts";

let root: string;

before(() => {
	root = mkdtempSync(join(tmpdir(), "syntax-bot-jail-"));
});

after(() => {
	rmSync(root, { recursive: true, force: true });
});

function loadJail(options: { allowBash?: boolean } = {}): Stub {
	const stub = createStub({ cwd: root });
	const jail = createJailExtension({ root, allowBash: options.allowBash });
	const factory = typeof jail === "function" ? jail : jail.factory;
	factory(stub.pi);
	return stub;
}

async function callTool(stub: Stub, toolName: string, input: Record<string, unknown>) {
	return stub.emitFirst("tool_call", { toolName, toolCallId: "t1", input });
}

describe("isInsideRoot", () => {
	it("lässt die Wurzel selbst und Kinder zu", () => {
		assert.equal(isInsideRoot(root, root), true);
		assert.equal(isInsideRoot(root, join(root, "a.txt")), true);
		assert.equal(isInsideRoot(root, join(root, "tief", "verschachtelt", "a.txt")), true);
	});

	it("erkennt Ausbrüche über .. und absolute Pfade", () => {
		assert.equal(isInsideRoot(root, join(root, "..", "draußen.txt")), false);
		assert.equal(isInsideRoot(root, join(root, "..", "..", "weit-draußen.txt")), false);
		assert.equal(isInsideRoot(root, join(tmpdir(), "draußen.txt")), false);
	});

	it("lässt sich nicht von ähnlichen Präfixen täuschen", () => {
		// „root-suffix" beginnt mit dem Wurzelnamen, liegt aber außerhalb.
		assert.equal(isInsideRoot(root, `${root}-suffix`), false);
	});
});

describe("Web-Jail", () => {
	it("lässt Zugriffe innerhalb des Arbeitsbereichs durch", async () => {
		const stub = loadJail();
		assert.equal(await callTool(stub, "read", { path: "notizen.md" }), undefined);
		assert.equal(await callTool(stub, "write", { path: join("src", "index.ts"), content: "x" }), undefined);
		assert.equal(
			await callTool(stub, "edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] }),
			undefined,
		);
	});

	it("blockt Ausbrüche über relative und absolute Pfade", async () => {
		const stub = loadJail();

		const relativ = await callTool(stub, "read", { path: join("..", "..", "geheim.txt") });
		assert.equal(relativ?.block, true);
		assert.match(relativ.reason, /außerhalb des Arbeitsbereichs/);

		const absolut = await callTool(stub, "write", { path: join(tmpdir(), "geheim.txt"), content: "x" });
		assert.equal(absolut?.block, true);

		const edit = await callTool(stub, "edit", {
			path: join("..", "geheim.txt"),
			edits: [{ oldText: "a", newText: "b" }],
		});
		assert.equal(edit?.block, true);
	});

	it("lässt Aufrufe ohne Pfad zu (Standard ist das cwd)", async () => {
		const stub = loadJail();
		assert.equal(await callTool(stub, "grep", { pattern: "foo" }), undefined);
		assert.equal(await callTool(stub, "ls", {}), undefined);
	});

	it("blockt bash standardmäßig", async () => {
		const stub = loadJail();
		const verdict = await callTool(stub, "bash", { command: "ls" });
		assert.equal(verdict?.block, true);
		assert.match(verdict.reason, /Shell deaktiviert/);
	});

	it("lässt bash mit Opt-in durch", async () => {
		const stub = loadJail({ allowBash: true });
		assert.equal(await callTool(stub, "bash", { command: "ls" }), undefined);
	});

	it("rührt Werkzeuge ohne Pfad-Oberfläche nicht an", async () => {
		const stub = loadJail();
		assert.equal(await callTool(stub, "install_pi_package", { package: "npm:pi-web-access" }), undefined);
	});
});
