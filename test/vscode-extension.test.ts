/**
 * End-to-End-Test der VS-Code-Extension gegen das gebaute Bundle
 * (vscode/dist/extension.js). Das „vscode"-Modul wird gestubbt; die
 * Chat-Sitzung läuft danach echt — inklusive gebündelter Pi-Laufzeit und
 * geladener Extensions.
 *
 * Voraussetzung: `node vscode/esbuild.mjs` wurde ausgeführt.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const bundle = join(process.cwd(), "vscode", "dist", "extension.js");

if (!existsSync(bundle)) {
	console.error("Bundle fehlt — bitte zuerst „node vscode/esbuild.mjs“ ausführen.");
	process.exit(1);
}

// Minimaler vscode-Stub, damit das Bundle im Test lädt.
const registry = new Map();
const vscodeStub = {
	window: {
		registerWebviewViewProvider: (_id, provider) => {
			registry.set("provider", provider);
		},
		createOutputChannel: () => ({ info: () => {}, error: () => {} }),
		workspace: { workspaceFolders: undefined },
		commands: { registerCommand: () => ({}) },
		showInformationMessage: () => {},
	},
	commands: { registerCommand: () => ({}), executeCommand: async () => {} },
};
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
	if (request === "vscode") return vscodeStub;
	return originalLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const extension = require(bundle);

function tempAgentDir() {
	const basis = mkdtempSync(join(tmpdir(), "syntax-bot-vscode-"));
	const agentDir = join(basis, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify({ packages: [join(process.cwd(), "vscode", "dist", "pi-package")] }, null, 2)}\n`,
	);
	return agentDir;
}

test("activate registriert Provider und Commands", () => {
	const basis = mkdtempSync(join(tmpdir(), "syntax-bot-vscode-kontext-"));
	const kontext = {
		subscriptions: [],
		extensionPath: process.cwd(),
		globalStorageUri: { fsPath: join(basis, "storage") },
	};
	extension.activate(kontext);
	assert.ok(registry.has("provider"));
	assert.ok(kontext.subscriptions.length >= 2);
});

test("ChatSitzung startet Pi im Bundle und beantwortet /help", async () => {
	const nachrichten = [];
	const webview = { postMessage: async (n) => void nachrichten.push(n) };
	const sitzung = new extension.ChatSitzung(webview, tempAgentDir(), process.cwd());
	try {
		await sitzung.starten();
		// Die Seite meldet sich — erst danach wird der Sendekanal freigegeben.
		await sitzung.nachricht({ type: "hello" });
		await new Promise((auflösen) => setTimeout(auflösen, 120));
	} catch (fehler) {
		// Ohne installierte Modell-Anmeldedaten darf der Start nicht scheitern —
		// nur ohne funktionierendes Bundle/Extensions.
		throw fehler;
	}
	await sitzung.nachricht({ type: "prompt", text: "/help" });

	const texte = nachrichten
		.filter((n) => n.type === "update" && n.update.sessionUpdate === "agent_message_chunk")
		.map((n) => n.update.content.text)
		.join("");
	assert.match(texte, /Commands/i);

	// Die Modi sind als ACP-Modi angemeldet.
	const bereit = nachrichten.find((n) => n.type === "ready");
	assert.ok(Array.isArray(bereit?.modes) && bereit.modes.length === 4);
	sitzung.dispose();
});
