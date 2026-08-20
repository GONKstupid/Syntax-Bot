/**
 * Tests für OAuth/Session (web/server/auth.ts) und BYOM (web/server/byom.ts).
 *
 * Geprüft wird die reine Logik ohne Netzwerk gegen GitHub: Cookies,
 * Rate-Limit, Session-Limits und die Konfigurations-Validierung. Der
 * Modell-Abruf läuft gegen einen lokalen Ersatzserver.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	buildLoginUrl,
	clearSessionCookie,
	clientIp,
	darfVerbinden,
	oauthConfigFromEnv,
	parseCookieHeader,
	rateLimitOk,
	SessionStore,
	sessionCookie,
	sessionTokenFromHeader,
	type AuthConfig,
	type WebSession,
} from "../web/server/auth.ts";
import { applyByomToSession, fetchRemoteModels, validateByomConfig } from "../web/server/byom.ts";

const beispielConfig: AuthConfig = {
	clientId: "client-id",
	clientSecret: "geheim",
	publicUrl: "https://bot.example.de",
	secureCookie: true,
	maxSessionsPerUser: 2,
};

describe("oauthConfigFromEnv", () => {
	it("liefert null ohne GitHub-Zugangsdaten", () => {
		assert.equal(oauthConfigFromEnv({}), null);
		assert.equal(oauthConfigFromEnv({ SYNTAX_BOT_GITHUB_CLIENT_ID: "nur-id" }), null);
	});

	it("übernimmt Werte und Standardwerte", () => {
		const config = oauthConfigFromEnv({
			SYNTAX_BOT_GITHUB_CLIENT_ID: " id ",
			SYNTAX_BOT_GITHUB_CLIENT_SECRET: "secret",
			SYNTAX_BOT_PUBLIC_URL: "https://x.example/",
			SYNTAX_BOT_SECURE: "1",
			SYNTAX_BOT_MAX_SESSIONS: "4",
		});
		assert.ok(config);
		assert.equal(config.clientId, "id");
		assert.equal(config.publicUrl, "https://x.example");
		assert.equal(config.secureCookie, true);
		assert.equal(config.maxSessionsPerUser, 4);
	});
});

describe("buildLoginUrl", () => {
	it("enthält Client, Weiterleitung, Scope und State", () => {
		const url = new URL(buildLoginUrl(beispielConfig, "zustand-123"));
		assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
		assert.equal(url.searchParams.get("client_id"), "client-id");
		assert.equal(url.searchParams.get("redirect_uri"), "https://bot.example.de/auth/callback");
		assert.equal(url.searchParams.get("scope"), "read:user");
		assert.equal(url.searchParams.get("state"), "zustand-123");
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
	it("normalisiert gültige Eingaben", () => {
		const config = validateByomConfig({
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

	it("lehnt fehlende oder falsche Angaben ab", () => {
		assert.throws(() => validateByomConfig({}), /Endpunkt/);
		assert.throws(() => validateByomConfig({ baseUrl: "kein-url", modelId: "x" }), /ungültig/);
		assert.throws(() => validateByomConfig({ baseUrl: "ftp://host", modelId: "x" }), /http/);
		assert.throws(() => validateByomConfig({ baseUrl: "http://host" }), /Modell-ID/);
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
		assert.deepEqual(gesetzt, [{ id: "modell-b" }]);
	});
});
