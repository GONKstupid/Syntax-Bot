/**
 * Tests für Konten/Sessions (web/server/accounts.ts, web/server/auth.ts)
 * und BYOM (web/server/byom.ts).
 *
 * Geprüft wird die reine Logik: Registrierung/Login mit scrypt-Hashes,
 * Cookies, Rate-Limit, Session-Limits und die Konfigurations-Validierung.
 * Der Modell-Abruf läuft gegen einen lokalen Ersatzserver.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { hashPasswort, KontoStore, pruefeHash } from "../vscode/web/server/accounts.ts";
import {
	clearSessionCookie,
	clientIp,
	darfVerbinden,
	parseCookieHeader,
	rateLimitOk,
	SessionStore,
	sessionCookie,
	sessionTokenFromHeader,
	webAuthConfigFromEnv,
	type WebSession,
} from "../vscode/web/server/auth.ts";
import { lookup } from "node:dns/promises";
import {
	applyByomToSession,
	fetchRemoteModels,
	pruefeEndpunkt,
	validateByomConfig,
} from "../vscode/web/server/byom.ts";

describe("webAuthConfigFromEnv", () => {
	it("setzt Standardwerte", () => {
		const config = webAuthConfigFromEnv({});
		assert.equal(config.secureCookie, false);
		assert.equal(config.maxSessionsPerUser, 2);
	});

	it("übernimmt Werte und fällt bei Unsinn auf den Standard zurück", () => {
		const config = webAuthConfigFromEnv({ SYNTAX_BOT_SECURE: "1", SYNTAX_BOT_MAX_SESSIONS: "4" });
		assert.equal(config.secureCookie, true);
		assert.equal(config.maxSessionsPerUser, 4);
		assert.equal(webAuthConfigFromEnv({ SYNTAX_BOT_MAX_SESSIONS: "unsinn" }).maxSessionsPerUser, 2);
	});
});

describe("KontoStore (Registrierung und Anmeldung)", () => {
	async function neuerStore(): Promise<KontoStore> {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-konten-"));
		return new KontoStore(join(verzeichnis, "web-accounts.json"));
	}

	it("legt ein Konto an und meldet damit an", async () => {
		const store = await neuerStore();
		const konto = await store.registrieren("ada_lovelace", "ada@example.de", "geheimnis1");
		assert.equal(konto.nutzername, "ada_lovelace");
		assert.ok(konto.passwortHash.length > 0);
		assert.notEqual(konto.passwortHash, "geheimnis1");

		// Anmeldung über Nutzername und über E-Mail.
		assert.equal((await store.anmelden("ada_lovelace", "geheimnis1")).id, konto.id);
		assert.equal((await store.anmelden("ADA@example.de", "geheimnis1")).id, konto.id);
	});

	it("lehnt falsche Passwörter und unbekannte Kennungen gleich ab", async () => {
		const store = await neuerStore();
		await store.registrieren("grace", "grace@example.de", "geheimnis1");
		await assert.rejects(store.anmelden("grace", "falsch123"), /falsch/);
		await assert.rejects(store.anmelden("unbekannt", "geheimnis1"), /falsch/);
	});

	it("erkennt doppelte Nutzernamen und E-Mails (auch anders geschrieben)", async () => {
		const store = await neuerStore();
		await store.registrieren("hopper", "hopper@example.de", "geheimnis1");
		await assert.rejects(store.registrieren("HOPPER", "neu@example.de", "geheimnis1"), /vergeben/);
		await assert.rejects(store.registrieren("anders", "Hopper@Example.de", "geheimnis1"), /registriert/);
	});

	it("prüft die Angaben vor dem Anlegen", async () => {
		const store = await neuerStore();
		await assert.rejects(store.registrieren("ab", "x@example.de", "geheimnis1"), /Nutzername/);
		await assert.rejects(store.registrieren("gültig!", "x@example.de", "geheimnis1"), /Nutzername/);
		await assert.rejects(store.registrieren("hopper", "keine-mail", "geheimnis1"), /E-Mail/);
		await assert.rejects(store.registrieren("hopper", "x@example.de", "kurz"), /Passwort/);
	});

	it("persistiert Konten und findet sie nach Neuladen", async () => {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-konten-"));
		const datei = join(verzeichnis, "web-accounts.json");
		const konto = await new KontoStore(datei).registrieren("turing", "t@example.de", "geheimnis1");
		const neuGeladen = new KontoStore(datei);
		assert.equal((await neuGeladen.anmelden("turing", "geheimnis1")).id, konto.id);
		assert.equal((await neuGeladen.hole(konto.id))?.email, "t@example.de");
		// Die Datei enthält keine Klartext-Passwörter.
		assert.ok(!(await readFile(datei, "utf8")).includes("geheimnis1"));
	});

	it("ändert das Passwort nur mit korrektem altem Passwort", async () => {
		const store = await neuerStore();
		const konto = await store.registrieren("goblin", "goblin@example.de", "geheimnis1");

		await assert.rejects(
			store.passwortAendern(konto.id, "falsch123", "neu-geheim1"),
			/aktuelle Passwort ist falsch/,
		);
		await assert.rejects(
			store.passwortAendern(konto.id, "geheimnis1", "kurz"),
			/mindestens 8 Zeichen/,
		);
		await store.passwortAendern(konto.id, "geheimnis1", "neu-geheim1");
		// Altes Passwort gilt nicht mehr, neues schon.
		await assert.rejects(store.anmelden("goblin", "geheimnis1"), /falsch/);
		assert.equal((await store.anmelden("goblin", "neu-geheim1")).id, konto.id);
	});

	it("löscht ein Konto endgültig", async () => {
		const store = await neuerStore();
		const konto = await store.registrieren("goblin", "goblin@example.de", "geheimnis1");
		assert.equal(await store.loeschen("unbekannt"), false);
		assert.equal(await store.loeschen(konto.id), true);
		await assert.rejects(store.anmelden("goblin", "geheimnis1"), /falsch/);
		assert.equal(await store.hole(konto.id), undefined);
	});
});

describe("scrypt-Hash und timing-sicherer Vergleich", () => {
	it("hashPasswort ist stabil pro Salt und pruefeHash vergleicht korrekt", async () => {
		const eins = await hashPasswort("geheimnis1", "salz-eins");
		const nochmal = await hashPasswort("geheimnis1", "salz-eins");
		const anderesSalz = await hashPasswort("geheimnis1", "salz-zwei");
		assert.equal(eins, nochmal);
		assert.notEqual(eins, anderesSalz);
		assert.equal(pruefeHash(eins, nochmal), true);
		assert.equal(pruefeHash(eins, anderesSalz), false);
		// Unterschiedliche Längen dürfen keinen Vergleichsfehler werfen.
		assert.equal(pruefeHash(eins, "ab"), false);
	});
});

describe("Cookies", () => {
	it("parseCookieHeader trennt und dekodiert", () => {
		const kekse = parseCookieHeader("a=1; syntax-bot-session=abc%20def; kaputt");
		assert.deepEqual(kekse, { a: "1", "syntax-bot-session": "abc def" });
	});

	it("sessionTokenFromHeader findet das Session-Cookie", () => {
		assert.equal(sessionTokenFromHeader("x=y; syntax-bot-session=token1"), "token1");
		assert.equal(sessionTokenFromHeader(undefined), undefined);
	});

	const sitzung: WebSession = { token: "tok", user: { id: "7", login: "ada" }, createdAt: 0 };

	it("sessionCookie ist HttpOnly und SameSite=Lax, Secure nur mit Flag", () => {
		const normal = sessionCookie(sitzung, false);
		assert.ok(normal.startsWith("syntax-bot-session=tok"));
		assert.ok(normal.includes("HttpOnly"));
		assert.ok(normal.includes("SameSite=Lax"));
		assert.ok(!normal.includes("Secure"));
		assert.ok(sessionCookie(sitzung, true).includes("Secure"));
	});

	it("clearSessionCookie setzt Max-Age=0", () => {
		assert.ok(clearSessionCookie(false).includes("Max-Age=0"));
	});
});

describe("SessionStore und Verbindungslimit", () => {
	it("verwaltet Sessions pro Nutzer", () => {
		const store = new SessionStore();
		const ada = store.create({ id: "1", login: "ada" });
		store.create({ id: "1", login: "ada" });
		store.create({ id: "2", login: "grace" });

		assert.equal(store.get(ada.token)?.user.login, "ada");
		assert.equal(store.countForUser("1"), 2);
		store.delete(ada.token);
		assert.equal(store.get(ada.token), undefined);
		assert.equal(store.countForUser("1"), 1);
	});

	it("deleteForUser beendet alle Sitzungen — optional außer der aktuellen", () => {
		const store = new SessionStore();
		const eins = store.create({ id: "1", login: "ada" });
		const zwei = store.create({ id: "1", login: "ada" });
		const fremd = store.create({ id: "2", login: "grace" });

		store.deleteForUser("1", eins.token);
		assert.ok(store.get(eins.token)); // aktuelle Sitzung bleibt
		assert.equal(store.get(zwei.token), undefined);
		assert.ok(store.get(fremd.token)); // anderer Nutzer unberührt

		store.deleteForUser("1");
		assert.equal(store.countForUser("1"), 0);
	});

	it("darfVerbinden blockt ab dem Maximum", () => {
		assert.equal(darfVerbinden(0, 2), true);
		assert.equal(darfVerbinden(1, 2), true);
		assert.equal(darfVerbinden(2, 2), false);
	});
});

describe("rateLimitOk", () => {
	it("erlaubt bis zum Maximum und öffnet das Fenster wieder", () => {
		const zaehler = new Map<string, number[]>();
		for (let i = 0; i < 3; i++) assert.equal(rateLimitOk(zaehler, "ip", 1000 + i, 100, 3), true);
		assert.equal(rateLimitOk(zaehler, "ip", 1004, 100, 3), false);
		// Nach Ablauf des Fensters ist wieder Platz.
		assert.equal(rateLimitOk(zaehler, "ip", 1101, 100, 3), true);
	});
});

describe("clientIp", () => {
	const request = {
		headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } as IncomingMessage["headers"],
		socket: { remoteAddress: "127.0.0.1" },
	};

	it("nutzt ohne Vertrauen die Socket-Adresse", () => {
		assert.equal(clientIp(request as never, false), "127.0.0.1");
	});

	it("wertet X-Forwarded-For nur bei Vertrauen aus", () => {
		assert.equal(clientIp(request as never, true), "203.0.113.9");
	});
});

describe("validateByomConfig", () => {
	it("normalisiert gültige Eingaben", async () => {
		const config = await validateByomConfig({
			baseUrl: " http://localhost:11434/v1/ ",
			modelId: " llama3.1:8b ",
			apiKey: " ",
		});
		assert.equal(config.baseUrl, "http://localhost:11434/v1");
		assert.equal(config.modelId, "llama3.1:8b");
		assert.equal(config.apiKey, "");
		assert.equal(config.displayName, "localhost:11434");
		assert.equal(config.providerId, "byom-localhost-11434");
	});

	it("lehnt fehlende oder falsche Angaben ab", async () => {
		await assert.rejects(validateByomConfig({}), /Endpunkt/);
		await assert.rejects(validateByomConfig({ baseUrl: "kein-url", modelId: "x" }), /ungültig/);
		await assert.rejects(validateByomConfig({ baseUrl: "ftp://host", modelId: "x" }), /http/);
		await assert.rejects(validateByomConfig({ baseUrl: "http://host" }), /Modell-ID/);
	});
});

describe("SSRF-Schutz (pruefeEndpunkt)", () => {
	it("erlaubt Loopback und RFC1918 für lokale Modelle", async () => {
		for (const url of [
			"http://127.0.0.1:11434",
			"http://192.168.1.20:1234/v1",
			"http://10.0.0.5:8080",
			"http://172.16.9.9",
			"http://localhost:11434/v1",
		]) {
			await assert.doesNotReject(pruefeEndpunkt(url), url);
		}
	});

	it("blockiert Metadaten-, Link-local- und Reserve-Adressen immer", async () => {
		for (const url of [
			"http://169.254.169.254/latest/meta-data/",
			"http://0.0.0.0/",
			"http://100.64.0.1/",
			"http://224.0.0.1/",
			"http://[fe80::1]/",
			"http://[::ffff:169.254.169.254]/",
		]) {
			await assert.rejects(pruefeEndpunkt(url), /nicht erlaubt/, url);
		}
	});

	it("löst Hostnamen auf und erkennt private Antworten", async () => {
		// „localhost" ist ein echter DNS-Name mit privater Antwortadresse.
		await assert.doesNotReject(pruefeEndpunkt("http://localhost:11434"));
		const ergebnis = await lookup("localhost", { all: true });
		assert.ok(ergebnis.length > 0);
	});

	it("lehnt im Strict-Modus auch private Bereiche ab", async () => {
		process.env.SYNTAX_BOT_BYOM_STRICT = "1";
		try {
			await assert.rejects(
				pruefeEndpunkt("http://127.0.0.1:11434"),
				/BYOM_STRICT/,
			);
			await assert.rejects(pruefeEndpunkt("http://192.168.1.20/"), /BYOM_STRICT/);
		} finally {
			delete process.env.SYNTAX_BOT_BYOM_STRICT;
		}
	});
});

/** Lokaler Ersatzserver für den Modell-Endpunkt. */
function startErsatzServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; schliessen: () => Promise<void> }> {
	return new Promise((resolve) => {
		const server = createServer(handler);
		server.listen(0, "127.0.0.1", () => {
			const adresse = server.address();
			const port = typeof adresse === "object" && adresse ? adresse.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}`,
				schliessen: () => new Promise((fertig) => server.close(() => fertig())),
			});
		});
	});
}

function jsonAntwort(res: ServerResponse, daten: unknown): void {
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify(daten));
}

describe("fetchRemoteModels", () => {
	it("versteht das OpenAI-Format und den API-Key-Header", async () => {
		const ersatz = await startErsatzServer((req, res) => {
			if (req.url === "/v1/models" && req.headers.authorization === "Bearer k1") {
				return jsonAntwort(res, { data: [{ id: "modell-a" }, { id: "modell-b" }] });
			}
			res.writeHead(404).end();
		});
		try {
			const modelle = await fetchRemoteModels(ersatz.url, "k1");
			assert.deepEqual(modelle, ["modell-a", "modell-b"]);
		} finally {
			await ersatz.schliessen();
		}
	});

	it("versteht das Ollama-Format über den Rückfallpfad /models", async () => {
		const ersatz = await startErsatzServer((req, res) => {
			if (req.url === "/models") return jsonAntwort(res, { models: [{ name: "phi3" }] });
			res.writeHead(404).end();
		});
		try {
			// Basis ohne /v1: erst wird /v1/models versucht (404), dann der
			// Rückfall auf /models mit dem Ollama-Format.
			const modelle = await fetchRemoteModels(ersatz.url, "");
			assert.deepEqual(modelle, ["phi3"]);
		} finally {
			await ersatz.schliessen();
		}
	});

	it("meldet einen klaren Fehler ohne Modelle", async () => {
		const ersatz = await startErsatzServer((_req, res) => res.writeHead(500).end());
		try {
			await assert.rejects(fetchRemoteModels(ersatz.url, ""), /keine Modell-Liste/);
		} finally {
			await ersatz.schliessen();
		}
	});
});

describe("applyByomToSession", () => {
	it("registriert den Provider und setzt das gewählte Modell", async () => {
		let registrierung: { providerId?: string; payload?: Record<string, unknown> } = {};
		const gesetzt: Array<{ id: string }> = [];
		const fakeSession = {
			modelRuntime: {
				registerProvider(providerId: string, payload: Record<string, unknown>) {
					registrierung = { providerId, payload };
				},
				async getAvailable(providerId: string) {
					assert.equal(providerId, "byom-test");
					return [{ id: "modell-a" }, { id: "modell-b" }];
				},
			},
			async setModel(modell: { id: string }) {
				gesetzt.push(modell);
			},
		};

		await applyByomToSession(fakeSession as never as AgentSession, {
			providerId: "byom-test",
			displayName: "Test",
			baseUrl: "http://127.0.0.1:9",
			apiKey: "geheim",
			modelId: "modell-b",
		});

		assert.equal(registrierung.providerId, "byom-test");
		assert.ok(registrierung.payload);
		assert.equal(registrierung.payload.api, "openai-completions");
		assert.equal(registrierung.payload.apiKey, "geheim");
		// Freie Endpunkte liefern nicht immer finish_reason — der Kompat-Schalter
		// verhindert den Abbruch „Stream ended without finish_reason".
		const modelle = registrierung.payload.models as Array<{ compat?: { supportsFinishReason?: boolean } }>;
		assert.equal(modelle[0]?.compat?.supportsFinishReason, false);
		assert.deepEqual(gesetzt, [{ id: "modell-b" }]);
	});
});
