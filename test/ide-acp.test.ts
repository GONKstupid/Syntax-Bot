/**
 * Tests für den IDE-Adapter (Phase 2c): ACP-Framing und Adapter-Verhalten
 * gegen Speicher-Verbindungen — ohne Zed und ohne echte Pi-Session.
 * Die Pi-Session wird gefaktet; geprüft wird die Übersetzung in beide
 * Richtungen: Anfragen des Editors und Ereignisse der Session.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AcpVerbindung, type RpcNotification, type RpcRequest } from "../ide/acp.ts";
import { AcpAdapter } from "../ide/adapter.ts";

/** Ausgehende Adapter-Zeilen in session/update-Objekte zerlegen. */
function fangeAuf(zeile: string, ziel: Array<{ update: { [key: string]: unknown } }>): void {
	try {
		const nachricht = JSON.parse(zeile) as { method?: string; params?: { update?: unknown } };
		if (nachricht.method === "session/update" && nachricht.params?.update) {
			ziel.push(nachricht.params as { update: { [key: string]: unknown } });
		}
	} catch {
		// Test-Rauschen ignorieren.
	}
}

function fakePi() {
	const empfangeneEreignisse: Array<(ereignis: Record<string, unknown>) => void> = [];
	const fake = {
		prompts: [] as string[],
		sessionManager: {
			newSession() {
				return "neue-id";
			},
		},
		settingsManager: new Proxy(
			{},
			{
				get(_ziel, prop: string) {
					if (prop === "getCompactionEnabled") return () => true;
					if (prop === "getSteeringMode" || prop === "getFollowUpMode") return () => "all";
					if (prop.startsWith("get")) return () => "";
					return () => undefined;
				},
			},
		),
		getAvailableThinkingLevels() {
			return ["minimal", "low", "medium", "high"];
		},
		setThinkingLevel(_level: string) {},
		setAutoCompactionEnabled(_an: boolean) {},
		modelRuntime: {
			async getAvailable() {
				return [] as Array<{ id: string; provider?: string }>;
			},
			async login(_providerId: string, _typ: string, interaktion: { prompt: () => Promise<string> }) {
				return { typ: "api_key", schluessel: await interaktion.prompt() };
			},
			async logout(_providerId: string) {},
		},
		subscribe(fn: (ereignis: Record<string, unknown>) => void) {
			empfangeneEreignisse.push(fn);
			return () => {};
		},
		async prompt(text: string) {
			fake.prompts.push(text);
			for (const fn of empfangeneEreignisse) {
				fn({ type: "message_start", message: { role: "assistant", content: [] } });
				fn({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "fertig" }] },
				});
			}
		},
		async abort() {},
		dispose() {},
	};
	return fake;
}

describe("AcpVerbindung (Framing)", () => {
	it("beantwortet Anfragen und liefert Ergebnisse zurück", async () => {
		let empfangen: RpcRequest | null = null;
		const a = new AcpVerbindung(
			(zeile) => b.daten(`${zeile}\n`),
			async (anfrage) => {
				empfangen = anfrage;
				return { echo: (anfrage.params as { x?: number }).x };
			},
			() => {},
		);
		const b = new AcpVerbindung(
			(zeile) => a.daten(`${zeile}\n`),
			async () => ({}),
			() => {},
		);
		const ergebnis = (await b.anfragen("test/methode", { x: 42 })) as { echo: number };
		assert.equal(ergebnis.echo, 42);
		assert.equal((empfangen as RpcRequest | null)?.method, "test/methode");
	});

	it("trennt an Zeilen, auch wenn Daten häppisch ankommen", () => {
		const benachrichtigungen: RpcNotification[] = [];
		const a = new AcpVerbindung(
			() => {},
			async () => ({}),
			(n) => benachrichtigungen.push(n),
		);
		a.daten('{"jsonrpc":"2.0","meth');
		a.daten('od":"a/b","params":{"k":1}}\n{"jsonrpc":"2.0","method":"c/d"}\n');
		assert.equal(benachrichtigungen.length, 2);
		assert.deepEqual(benachrichtigungen[0].params as { k: number }, { k: 1 });
		assert.equal(benachrichtigungen[1].method, "c/d");
	});

	it("wirft bei Fehlerantworten eine Ausnahme statt zu hängen", async () => {
		const a = new AcpVerbindung(
			(zeile) => {
				// Der „Editor“ lehnt jede Anfrage mit einer Fehlerantwort ab.
				const nachricht = JSON.parse(zeile) as { id: number };
				a.daten(
					`${JSON.stringify({ jsonrpc: "2.0", id: nachricht.id, error: { code: -1, message: "kaputt" } })}\n`,
				);
			},
			async () => ({}),
			() => {},
		);
		await assert.rejects(a.anfragen("x/y"), /kaputt/);
	});
});

describe("AcpAdapter", () => {
	function adapterMitFake(fake: ReturnType<typeof fakePi>): { adapter: AcpAdapter; verbindung: AcpVerbindung } {
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			() => {},
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			(benachrichtigung) => adapter.benachrichtigung(benachrichtigung),
		);
		return { adapter, verbindung };
	}

	it("initialize spiegelt die Protokollversion und meldet Fähigkeiten", async () => {
		const { adapter, verbindung } = adapterMitFake(fakePi());
		const ergebnis = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1 },
		})) as { protocolVersion: number; agentCapabilities: { loadSession: boolean } };
		assert.equal(ergebnis.protocolVersion, 1);
		assert.equal(ergebnis.agentCapabilities.loadSession, true);
	});

	it("session/new meldet die vier Modi und gibt die Slash-Commands bekannt", async () => {
		const fake = fakePi();
		const updates: RpcNotification[] = [];
		fake.subscribe((e) => updates.push(e));
		const { adapter, verbindung } = adapterMitFake(fake);

		const ergebnis = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: "C:\\projekt" },
		})) as { sessionId: string; modes: { currentModeId: string; availableModes: { id: string }[] } };

		assert.ok(ergebnis.sessionId);
		assert.equal(ergebnis.modes.currentModeId, "default");
		assert.deepEqual(ergebnis.modes.availableModes.map((m) => m.id), [
			"default",
			"syntax-fix",
			"code-fix",
			"cleanup",
		]);
	});

	it("session/prompt reicht den Text an Pi durch und streamt die Antwort", async () => {
		const fake = fakePi();
		const { adapter, verbindung } = adapterMitFake(fake);

		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 3,
			method: "session/new",
			params: { cwd: "." },
		})) as { sessionId: string };

		const ergebnis = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 4,
			method: "session/prompt",
			params: {
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Korrigiere bitte @src/app.ts" }],
			},
		})) as { stopReason: string };

		assert.equal(ergebnis.stopReason, "end_turn");
		assert.deepEqual(fake.prompts, ["Korrigiere bitte @src/app.ts"]);
	});

	it("ein Prompt-Fehler wird als Klartext gemeldet, nicht als „refusal“", async () => {
		const fake = fakePi();
		fake.prompt = async () => {
			throw new Error("Kein Modell eingerichtet.");
		};
		const updates: Array<{ update: { sessionUpdate?: string; content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);

		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 18,
			method: "session/new",
			params: {},
		})) as { sessionId: string };

		const ergebnis = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 19,
			method: "session/prompt",
			params: { sessionId: session.sessionId, prompt: [{ type: "text", text: "Hallo?" }] },
		})) as { stopReason: string };

		assert.equal(ergebnis.stopReason, "end_turn");
		const fehlermeldung = updates.find(
			(u) => u.update.sessionUpdate === "agent_message_chunk" && u.update.content?.text?.includes("Kein Modell"),
		);
		assert.ok(fehlermeldung, "Fehlermeldung sollte als Chat-Text ankommen.");
	});

	it("ohne eingerichtetes Modell gibt es beim Session-Start einen Hinweis", async () => {
		const fake = fakePi();
		Object.defineProperty(fake, "model", { value: undefined });
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);

		await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 20,
			method: "session/new",
			params: {},
		});
		const hinweis = updates.find((u) => u.update.content?.text?.includes("kein Modell eingerichtet"));
		assert.ok(hinweis, "Modell-Hinweis sollte beim Start erscheinen.");
	});

	it("/model listet Modelle auf und /model <id> wechselt", async () => {
		const fake = fakePi();
		const modelle = [
			{ id: "claude-sonnet-5", provider: "anthropic" },
			{ id: "llama3.1:8b", provider: "ollama" },
		];
		Object.defineProperty(fake, "model", { value: { id: "claude-sonnet-5" }, configurable: true });
		(fake as unknown as { modelRuntime: object }).modelRuntime = {
			async getAvailable() {
				return modelle;
			},
		};
		const gesetzt: string[] = [];
		fake.setModel = async (modell: { id: string }) => {
			gesetzt.push(modell.id);
		};
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 30,
			method: "session/new",
			params: {},
		})) as { sessionId: string };
		const frage = async (id: number, text: string) =>
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id,
				method: "session/prompt",
				params: { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
			});

		await frage(31, "/model");
		const liste = updates.at(-1)?.update.content?.text ?? "";
		assert.ok(liste.includes("claude-sonnet-5"), liste);
		assert.ok(liste.includes("← aktiv"), liste);

		await frage(32, "/model llama3.1:8b");
		assert.deepEqual(gesetzt, ["llama3.1:8b"]);
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("gewechselt"));

		// Pi selbst bekommt von den IDE-Commands nichts ab.
		assert.deepEqual(fake.prompts, []);
	});

	it("/settings zeigt den vollen Katalog und kippt Werte im Chat", async () => {
		const fake = fakePi();
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		let autoKompaktGesetzt: boolean | undefined;
		fake.setAutoCompactionEnabled = (an: boolean) => {
			autoKompaktGesetzt = an;
		};
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 33,
			method: "session/new",
			params: {},
		})) as { sessionId: string };
		const frage = async (id: number, text: string) =>
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id,
				method: "session/prompt",
				params: { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
			});

		await frage(34, "/settings");
		await new Promise((resolve) => setTimeout(resolve, 10));
		const menü = updates.map((u) => u.update.content?.text ?? "").join("\n");
		// Der Katalog deckt dieselben Optionen ab wie der CLI-Dialog.
		for (const label of ["Auto-compact", "Steering mode", "Transport", "Thinking level", "Quiet startup"]) {
			assert.ok(menü.includes(label), `Menü sollte „${label}" enthalten`);
		}

		// „1" kippt Auto-compact sofort; danach kommt das Menü erneut.
		await frage(35, "1");
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(autoKompaktGesetzt, false);
		const texte = updates.map((u) => u.update.content?.text ?? "");
		assert.ok(
			texte.some((t) => t.includes("Auto-Kompaktierung ist jetzt **aus**")),
			texte.join("|||"),
		);

		// Mit etwas anderem als einer Ziffer wird geschlossen.
		await frage(36, "fertig");
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("geschlossen"));
	});

	it("/new, /tools und TUI-Fallback verhalten sich korrekt", async () => {
		const fake = fakePi();
		let neueSession = 0;
		fake.sessionManager.newSession = () => {
			neueSession++;
			return "id";
		};
		fake.getActiveToolNames = () => ["read", "edit"];
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 40,
			method: "session/new",
			params: {},
		})) as { sessionId: string };
		const frage = async (id: number, text: string) =>
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id,
				method: "session/prompt",
				params: { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
			});

		await frage(41, "/new");
		assert.equal(neueSession, 1);
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("Neue Session"));

		await frage(42, "/tools");
		const werkzeuge = updates.at(-1)?.update.content?.text ?? "";
		assert.ok(werkzeuge.includes("read") && werkzeuge.includes("edit"), werkzeuge);

		await frage(43, "/tree");
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("Terminal-TUI"));
		// TUI-Commands dürfen nicht an Pi durchgereicht werden.
		assert.deepEqual(fake.prompts, []);
	});

	it("/login api <provider> fragt den Key im Chat ab und meldet an", async () => {
		const fake = fakePi();
		const logins: Array<{ provider?: string; typ?: string; schluessel?: string }> = [];
		(fake as unknown as { modelRuntime: object }).modelRuntime = {
			getProviders() {
				return [
					{ id: "anthropic", name: "Anthropic", auth: { apiKey: { name: "Anthropic API key" } } },
					{ id: "anthropic-oauth", name: "Claude Pro/Max", auth: { oauth: { name: "Claude" } } },
				];
			},
			async getAvailable() {
				return [];
			},
			async login(providerId: string, typ: string, interaktion: { prompt: () => Promise<string> }) {
				const schluessel = await interaktion.prompt({ message: "Key:" });
				logins.push({ provider: providerId, typ, schluessel });
				return { type: "api_key" };
			},
			async logout(_providerId: string) {},
		};
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 44,
			method: "session/new",
			params: {},
		})) as { sessionId: string };
		const frage = async (id: number, text: string) =>
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id,
				method: "session/prompt",
				params: { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
			});

		await frage(45, "/login api anthropic");
		await new Promise((resolve) => setTimeout(resolve, 20));
		// Der Adapter hat nach dem Key gefragt — die nächste Nachricht ist die Antwort.
		const keyFrage = updates.some((u) => u.update.content?.text?.includes("API-Key"));
		assert.ok(keyFrage, "Key-Abfrage erwartet");

		await frage(46, "sk-test-123");
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.deepEqual(logins, [{ provider: "anthropic", typ: "api_key", schluessel: "sk-test-123" }]);
		const texte = updates.map((u) => u.update.content?.text ?? "").join("\n");
		assert.ok(texte.includes("angemeldet"));
		assert.ok(texte.includes("Anthropic"), "Provider-Auswahl sollte Anthropic enthalten");
		assert.deepEqual(fake.prompts, []);
	});

	it("der geführte /login-Dialog führt über Ziffern zum Ziel (Browser-Anmeldung)", async () => {
		const fake = fakePi();
		const logins: Array<{ provider?: string; typ?: string }> = [];
		let urlGemeldet = "";
		(fake as unknown as { modelRuntime: object }).modelRuntime = {
			getProviders() {
				return [
					{ id: "openai", name: "OpenAI", auth: { apiKey: { name: "OpenAI key" } } },
					{ id: "claude-max", name: "Claude Pro/Max", auth: { oauth: { name: "Claude" } } },
				];
			},
			async getAvailable() {
				return [];
			},
			async login(providerId: string, typ: string, interaktion: { notify: (e: Record<string, unknown>) => void }) {
				interaktion.notify({ type: "auth_url", url: "https://example.org/anmelden" });
				logins.push({ provider: providerId, typ });
				return { type: "oauth" };
			},
			async logout() {},
		};
		const updates: Array<{ update: { content?: { text?: string } } }> = [];
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		const verbindung = new AcpVerbindung(
			(zeile) => fangeAuf(zeile, updates),
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			() => {},
		);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 47,
			method: "session/new",
			params: {},
		})) as { sessionId: string };
		const frage = async (id: number, text: string) =>
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id,
				method: "session/prompt",
				params: { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
			});

		// 1. /login zeigt die drei Wege und fragt nach der Wahl.
		await frage(48, "/login");
		const menü = updates.at(-2)?.update.content?.text ?? "";
		assert.ok(menü.includes("**2**"), menü);
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("Deine Wahl"));

		// 2. „2“ → Browser-Anmeldung → Anbieterliste erscheint.
		await frage(49, "2");
		assert.ok((updates.at(-1)?.update.content?.text ?? "").includes("Claude Pro/Max"));

		// 3. Ziffer 1 wählt Claude Pro/Max → Login startet, URL kommt als Chat-Nachricht.
		await frage(50, "1");
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.deepEqual(logins, [{ provider: "claude-max", typ: "oauth" }]);
		urlGemeldet = updates.map((u) => u.update.content?.text ?? "").join("\n");
		assert.ok(urlGemeldet.includes("https://example.org/anmelden"));
		assert.deepEqual(fake.prompts, []);
	});

	it("session/set_mode führt den Modus als Pi-Command aus", async () => {
		const fake = fakePi();
		const { adapter, verbindung } = adapterMitFake(fake);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 5,
			method: "session/new",
			params: {},
		})) as { sessionId: string };

		await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 6,
			method: "session/set_mode",
			params: { sessionId: session.sessionId, modeId: "syntax-fix" },
		});
		await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 7,
			method: "session/set_mode",
			params: { sessionId: session.sessionId, modeId: "default" },
		});
		await assert.rejects(
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id: 8,
				method: "session/set_mode",
				params: { sessionId: session.sessionId, modeId: "quatsch" },
			}),
			/Unbekannter Modus/,
		);
		assert.deepEqual(fake.prompts, ["/syntax-fix", "/modus-aus"]);
	});

	it("session/load stellt die Pi-Session über das Mapping wieder her", async () => {
		const fake = fakePi();
		let erhalteneSessionDatei: string | undefined;
		const mappingDatei = join(tmpdir(), `sb-test-${randomUUID()}.json`);
		let anfrageIstLoad = false;
		// Das Fake-Pi meldet eine Session-Datei, die der Adapter mappen muss.
		const piDatei = join(tmpdir(), `sb-test-${randomUUID()}.pi.json`);
		writeFileSync(piDatei, "{}");
		(fake as { sessionFile?: string }).sessionFile = piDatei;
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			speicherPfad: mappingDatei,
			sessionErzeugen: async (_cwd, _agentDir, sessionFile) => {
				if (anfrageIstLoad) erhalteneSessionDatei = sessionFile;
				return fake as never;
			},
		});
		const verbindung = new AcpVerbindung(
			() => {},
			(anfrage) => adapter.anfrage(verbindung, anfrage),
			(benachrichtigung) => adapter.benachrichtigung(benachrichtigung),
		);

		const neu = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 12,
			method: "session/new",
			params: {},
		})) as { sessionId: string };

		anfrageIstLoad = true;
		await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 14,
			method: "session/load",
			params: { sessionId: neu.sessionId, cwd: "." },
		});
		assert.equal(erhalteneSessionDatei, piDatei);

		// Unbekannte Session wird sauber abgelehnt.
		await assert.rejects(
			adapter.anfrage(verbindung, {
				jsonrpc: "2.0",
				id: 15,
				method: "session/load",
				params: { sessionId: randomUUID(), cwd: "." },
			}),
			/nicht bekannt/,
		);
		rmSync(mappingDatei, { force: true });
		rmSync(piDatei, { force: true });
	});

	it("resource_link-Blöcke aus dem Editor werden zu @-Pfaden", async () => {
		const fake = fakePi();
		const { adapter, verbindung } = adapterMitFake(fake);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 16,
			method: "session/new",
			params: {},
		})) as { sessionId: string };

		await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 17,
			method: "session/prompt",
			params: {
				sessionId: session.sessionId,
				prompt: [
					{ type: "text", text: "Korrigiere diese Datei:" },
					{ type: "resource_link", uri: "file:///C%3A/projekt/src/app.ts", name: "app.ts" },
				],
			},
		});
		assert.equal(fake.prompts.length, 1);
		assert.ok(fake.prompts[0].includes("@C:/projekt/src/app.ts"), fake.prompts[0]);
	});

	it("session/cancel bricht die laufende Arbeit ab", async () => {
		const fake = fakePi();
		let abgebrochen = false;
		fake.abort = async () => {
			abgebrochen = true;
		};
		const { adapter, verbindung } = adapterMitFake(fake);
		const session = (await adapter.anfrage(verbindung, {
			jsonrpc: "2.0",
			id: 9,
			method: "session/new",
			params: {},
		})) as { sessionId: string };

		adapter.benachrichtigung({
			jsonrpc: "2.0",
			method: "session/cancel",
			params: { sessionId: session.sessionId },
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(abgebrochen, true);
	});

	it("unbekannte Methoden werden sauber abgelehnt", async () => {
		const { adapter, verbindung } = adapterMitFake(fakePi());
		await assert.rejects(
			adapter.anfrage(verbindung, { jsonrpc: "2.0", id: 10, method: "quatsch/methode" }),
			/nicht unterstützt/,
		);
	});

	it("die UI-Brücke mappt confirm auf eine Berechtigungsanfrage", async () => {
		const fake = fakePi();
		const adapter = new AcpAdapter({
			agentDir: "/nirgendwo",
			sessionErzeugen: async () => fake as never,
		});
		// Zwei gekreuzte Verbindungen: Seite „Editor“ beantwortet
		// Berechtigungsanfragen mit Ja.
		let erlaubnisParams: Record<string, unknown> | null = null;
		const adapterSeite = new AcpVerbindung(
			(zeile) => editorSeite.daten(`${zeile}\n`),
			async () => ({}),
			(benachrichtigung) => adapter.benachrichtigung(benachrichtigung),
		);
		const editorSeite = new AcpVerbindung(
			(zeile) => adapterSeite.daten(`${zeile}\n`),
			async (anfrage) => {
				assert.equal(anfrage.method, "session/request_permission");
				erlaubnisParams = anfrage.params as Record<string, unknown>;
				return { outcome: { outcome: "selected", optionId: "ja" } };
			},
			() => {},
		);
		const anfrageAnAdapter = async (id: number, methode: string, params?: unknown) =>
			adapter.anfrage(adapterSeite, { jsonrpc: "2.0", id, method: methode, params });

		const session = (await anfrageAnAdapter(11, "session/new", {})) as { sessionId: string };

		// Über die Brücke der Session bestätigen lassen.
		const gehostet = adapter["sessions"].get(session.sessionId);
		const ja = await gehostet!["bridge"].ui.confirm("Diff-Vorschau", "Änderungen übernehmen?");
		assert.equal(ja, true);
		assert.equal(erlaubnisParams?.sessionId, session.sessionId);
	});
});
