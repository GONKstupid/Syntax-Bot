#!/usr/bin/env node
/**
 * Syntax-Bot-Webserver — Einstieg.
 *
 *   node web/server/index.ts [--port 4711] [--host 127.0.0.1]
 *
 * Liefert die Oberfläche aus web/ui aus und hält pro WebSocket-Verbindung
 * eine eigene Pi-Session mit eigenem Arbeitsbereich (siehe session-host.ts).
 *
 * Zwei Betriebsarten:
 *  - Standard: Binden NUR auf localhost; „Ohne Konto fortfahren" ist möglich
 *    (Wegwerf-Session ohne Verlauf und ohne gemerkte Provider).
 *  - Öffentliches Binden verlangt SYNTAX_BOT_PUBLIC_BIND=1 — dann ist ein
 *    Konto Pflicht. Konten werden lokal angelegt (Nutzername/E-Mail/Passwort,
 *    siehe accounts.ts); HTTPS terminiert ein Reverse-Proxy (Caddy/nginx),
 *    bei HTTPS-Cookies SYNTAX_BOT_SECURE=1.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { KontoStore } from "./accounts.ts";
import { credentialDateiFuer } from "./konto-credentials.ts";
import { kontoIdVon } from "./provider-store.ts";
import {
	clearSessionCookie,
	clientIp,
	darfVerbinden,
	parseCookieHeader,
	rateLimitOk,
	sessionCookie,
	SessionStore,
	webAuthConfigFromEnv,
	type WebAuthConfig,
	type WebUser,
} from "./auth.ts";
import {
	defaultSessionHostOptions,
	SessionHost,
	type ClientMessage,
	type HostedSession,
	type SessionHostOptions,
} from "./session-host.ts";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".json": "application/json; charset=utf-8",
	".woff2": "font/woff2",
};

const SESSION_COOKIE_NAME = "syntax-bot-session";
/** Obergrenze für Anmelde-Formulare — mehr braucht niemand. */
const BODY_MAX_BYTES = 64 * 1024;

/** Ab hier wird die App ausgeliefert — die Startseite »/« ist die Anmeldung. */
const ROUTEN_DATEI: Record<string, string> = {
	"/app": "/index.html",
	"/konto": "/konto.html",
};

/** Mindeststruktur einer ws-Verbindung — das Paket ws liefert selbst keine Typen mit. */
interface SocketConnection {
	readonly readyState: number;
	readonly OPEN: number;
	send(data: string): void;
	close(): void;
	on(event: "message", listener: (data: { toString(): string }) => void): void;
	on(event: "close", listener: () => void): void;
}

interface ServerContext {
	auth: WebAuthConfig;
	kontos: KontoStore;
	sessions: SessionStore;
	/** Aktive WebSocket-Verbindungen pro Nutzer-ID. */
	wsCounts: Map<string, number>;
	/** Rate-Limit-Zähler pro Client-IP. */
	rateCounter: Map<string, number[]>;
	trustProxy: boolean;
	/** Anonyme Nutzung nur, solange der Server ausschließlich lokal bindet. */
	erlaubeAnonym: boolean;
	/** Pfade der isolierten Instanz — für das Aufräumen beim Konto-Löschen. */
	host: SessionHostOptions;
}

function parseArgs(argv: string[]): { port: number; host: string } {
	let port = Number(process.env.SYNTAX_BOT_WEB_PORT) || 4711;
	let host = process.env.SYNTAX_BOT_WEB_HOST || "127.0.0.1";

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--port" && argv[i + 1]) port = Number(argv[++i]);
		if (argv[i] === "--host" && argv[i + 1]) host = argv[++i];
	}
	return { port, host };
}

function istLoopback(host: string): boolean {
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function userFromRequest(context: ServerContext, request: IncomingMessage): WebUser | undefined {
	const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
	return context.sessions.get(token)?.user;
}

/** Statische Datei ausliefern — ohne je das UI-Verzeichnis zu verlassen.
    Routen ohne Dateiendung werden auf ihre Seite abgebildet (»/app« …). */
async function serveStatic(
	request: IncomingMessage,
	response: ServerResponse,
	context: ServerContext,
	datei?: string,
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://localhost");
	let pathname = datei ?? ROUTEN_DATEI[url.pathname] ?? url.pathname;
	if (pathname === "/") pathname = "/login.html";
	const filePath = normalize(join(uiDir, pathname));

	if (!filePath.startsWith(uiDir) || !existsSync(filePath)) {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Nicht gefunden.");
		return;
	}

	const inhalt = await readFile(filePath);
	response.writeHead(200, {
		"content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
		"cache-control": "no-store",
	});
	response.end(inhalt);
}

function antworteText(response: ServerResponse, status: number, text: string): void {
	response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	response.end(text);
}

function antworteJson(response: ServerResponse, status: number, daten: Record<string, unknown>, extraHeaders: Record<string, string | string[]> = {}): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders });
	response.end(JSON.stringify(daten));
}

/** Formular- oder JSON-Körper einlesen (kleine Grenze, dann Fehler). */
function leseKoerper(request: IncomingMessage): Promise<Record<string, string>> {
	return new Promise((resolve, reject) => {
		const teile: Buffer[] = [];
		let groesse = 0;
		request.on("data", (stueck: Buffer) => {
			groesse += stueck.length;
			if (groesse > BODY_MAX_BYTES) {
				reject(new Error("Die Anfrage ist zu groß."));
				request.destroy();
				return;
			}
			teile.push(stueck);
		});
		request.on("end", () => {
			const roh = Buffer.concat(teile).toString("utf8");
			if (!roh) return resolve({});
			try {
				const typ = String(request.headers["content-type"] ?? "");
				if (typ.includes("application/json")) {
					const daten = JSON.parse(roh) as Record<string, unknown>;
					const felder: Record<string, string> = {};
					for (const [name, wert] of Object.entries(daten)) felder[name] = String(wert ?? "");
					return resolve(felder);
				}
				const parameter = new URLSearchParams(roh);
				const felder: Record<string, string> = {};
				for (const [name, wert] of parameter) felder[name] = wert;
				return resolve(felder);
			} catch {
				reject(new Error("Der Anfragekörper ist ungültig."));
			}
		});
		request.on("error", () => reject(new Error("Die Anfrage konnte nicht gelesen werden.")));
	});
}

/* --- Konto-Routen ---------------------------------------------------------- */

async function behandleRegistrieren(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const ip = clientIp(request as never, context.trustProxy);
	if (!rateLimitOk(context.rateCounter, `registrieren:${ip}`, Date.now(), 60000, 10)) {
		return antworteJson(response, 429, { fehler: "Zu viele Registrierungen — bitte kurz warten." });
	}

	let felder: Record<string, string>;
	try {
		felder = await leseKoerper(request);
	} catch (error) {
		return antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}

	try {
		const konto = await context.kontos.registrieren(felder.nutzername ?? "", felder.email ?? "", felder.passwort ?? "");
		const session = context.sessions.create({ id: konto.id, login: konto.nutzername, email: konto.email });
		antworteJson(response, 200, { ok: true }, { "set-cookie": sessionCookie(session, context.auth.secureCookie) });
	} catch (error) {
		antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}
}

async function behandleAnmelden(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const ip = clientIp(request as never, context.trustProxy);
	if (!rateLimitOk(context.rateCounter, `anmelden:${ip}`, Date.now(), 60000, 20)) {
		return antworteJson(response, 429, { fehler: "Zu viele Anmeldeversuche — bitte kurz warten." });
	}

	let felder: Record<string, string>;
	try {
		felder = await leseKoerper(request);
	} catch (error) {
		return antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}

	const kennung = (felder.kennung ?? felder.nutzername ?? "").trim();
	try {
		const konto = await context.kontos.anmelden(kennung, felder.passwort ?? "");
		const session = context.sessions.create({ id: konto.id, login: konto.nutzername, email: konto.email });
		antworteJson(response, 200, { ok: true }, { "set-cookie": sessionCookie(session, context.auth.secureCookie) });
	} catch (error) {
		// Gleiche Meldung für unbekanntes Konto und falsches Passwort —
		// so verrät die Antwort nicht, welche Konten existieren.
		antworteJson(response, 401, { fehler: error instanceof Error ? error.message : String(error) });
	}
}

function behandleAbmelden(context: ServerContext, request: IncomingMessage, response: ServerResponse): void {
	const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
	if (token) context.sessions.delete(token);
	response.writeHead(302, {
		location: "/",
		"set-cookie": clearSessionCookie(context.auth.secureCookie),
	});
	response.end();
}

/** Angemeldeter Nutzer aus dem Cookie — sonst 401-Antwort. */
function nutzerOder401(
	context: ServerContext,
	request: IncomingMessage,
	response: ServerResponse,
): { token: string; nutzer: WebUser } | null {
	const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
	const nutzer = context.sessions.get(token)?.user;
	if (!nutzer) {
		antworteJson(response, 401, { fehler: "Nicht angemeldet." });
		return null;
	}
	return { token, nutzer };
}

async function behandlePasswortAendern(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const anmeldung = nutzerOder401(context, request, response);
	if (!anmeldung) return;

	let felder: Record<string, string>;
	try {
		felder = await leseKoerper(request);
	} catch (error) {
		return antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}

	try {
		await context.kontos.passwortAendern(anmeldung.nutzer.id, felder.passwortAlt ?? "", felder.passwortNeu ?? "");
		// Nach dem Wechsel sind alle anderen Sitzungen ungültig — diese bleibt.
		context.sessions.deleteForUser(anmeldung.nutzer.id, anmeldung.token);
		antworteJson(response, 200, { ok: true });
	} catch (error) {
		antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}
}

async function behandleKontoLoeschen(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const anmeldung = nutzerOder401(context, request, response);
	if (!anmeldung) return;

	let felder: Record<string, string>;
	try {
		felder = await leseKoerper(request);
	} catch (error) {
		return antworteJson(response, 400, { fehler: error instanceof Error ? error.message : String(error) });
	}

	// Löschung nur mit korrektem Passwort — schützt vor fremden Händen am Rechner.
	try {
		await context.kontos.anmelden(anmeldung.nutzer.login, felder.passwort ?? "");
	} catch {
		return antworteJson(response, 401, { fehler: "Das Passwort ist falsch — das Konto bleibt bestehen." });
	}

	const kontoId = kontoIdVon(anmeldung.nutzer);
	await context.host.threads.loescheAlle(kontoId);
	await context.host.providers.loescheAlle(kontoId);
	await rm(credentialDateiFuer(context.host.credentialsDir, kontoId), { force: true }).catch(() => {
		// Fehlende Datei ist kein Fehler.
	});
	const bereich = join(context.host.workspacesDir, `nutzer-${anmeldung.nutzer.id.replace(/[^a-zA-Z0-9_-]/g, "")}`);
	await rm(bereich, { recursive: true, force: true }).catch(() => {
		// Ohne Arbeitsbereich gibt es nichts zu entfernen.
	});
	await context.kontos.loeschen(anmeldung.nutzer.id);
	context.sessions.deleteForUser(anmeldung.nutzer.id);
	antworteJson(response, 200, { ok: true }, { "set-cookie": clearSessionCookie(context.auth.secureCookie) });
}

/* --- Hauptprogramm --------------------------------------------------------- */

async function main(): Promise<void> {
	const { port, host } = parseArgs(process.argv.slice(2));
	const options = defaultSessionHostOptions();
	const auth = webAuthConfigFromEnv();
	const erlaubeAnonym = istLoopback(host);

	const runtimeDir = join(process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot"), "runtime");
	if (!existsSync(runtimeDir)) {
		process.stderr.write("Pi-Runtime fehlt. Bitte zuerst »node scripts/bootstrap.mjs« ausführen.\n");
		process.exit(1);
	}

	if (!erlaubeAnonym && process.env.SYNTAX_BOT_PUBLIC_BIND !== "1") {
		process.stderr.write(
			"FEHLER: Öffentliches Binden verlangt eine bewusste Entscheidung.\n" +
				"Setze SYNTAX_BOT_PUBLIC_BIND=1 (Konten mit Nutzername/E-Mail/Passwort\n" +
				"sind eingebaut), oder binde auf 127.0.0.1.\n",
		);
		process.exit(1);
	}

	const context: ServerContext = {
		auth,
		kontos: new KontoStore(join(process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot"), "web-accounts.json")),
		sessions: new SessionStore(),
		wsCounts: new Map(),
		rateCounter: new Map(),
		trustProxy: process.env.SYNTAX_BOT_TRUST_PROXY === "1",
		erlaubeAnonym,
		host: options,
	};
	const sessionHost = new SessionHost(options);

	const server = createServer((request, response) => {
		const pfad = new URL(request.url ?? "/", "http://localhost").pathname;

		try {
			if (pfad === "/auth/register" && request.method === "POST") {
				return void behandleRegistrieren(context, request, response).catch(() => antworteText(response, 500, "Serverfehler bei der Registrierung."));
			}
			if (pfad === "/auth/login" && request.method === "POST") {
				return void behandleAnmelden(context, request, response).catch(() => antworteText(response, 500, "Serverfehler bei der Anmeldung."));
			}
			if (pfad === "/auth/logout") return behandleAbmelden(context, request, response);
			if (pfad === "/auth/password" && request.method === "POST") {
				return void behandlePasswortAendern(context, request, response).catch(() => antworteText(response, 500, "Serverfehler beim Passwort-Wechsel."));
			}
			if (pfad === "/auth/delete" && request.method === "POST") {
				return void behandleKontoLoeschen(context, request, response).catch(() => antworteText(response, 500, "Serverfehler beim Löschen des Kontos."));
			}

			const nutzer = userFromRequest(context, request);
			// Ohne Konto und ohne anonyme Freigabe kommt nur die Anmeldeseite
			// durch — statische Bausteine (CSS, JS, Schriften) braucht sie selbst.
			const istStatik = /\.[a-z0-9]+$/i.test(pfad);
			if (!context.erlaubeAnonym && !nutzer && !istStatik) {
				return void serveStatic(request, response, context, "/login.html");
			}
			// Angemeldet auf der Startseite → direkt zur App.
			if (pfad === "/" && nutzer) {
				response.writeHead(302, { location: "/app" });
				return response.end();
			}
			return void serveStatic(request, response, context);
		} catch (error) {
			antworteText(response, 500, `Serverfehler: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	const wss = new WebSocketServer({
		server,
		path: "/ws",
		verifyClient: (
			info: { req: IncomingMessage },
			callback: (result: boolean, code?: number, message?: string) => void,
		) => {
			const token = parseCookieHeader(info.req.headers.cookie)[SESSION_COOKIE_NAME];
			const session = context.sessions.get(token);
			if (!session) {
				// Ohne Konto nur im rein lokalen Betrieb (Wegwerf-Session).
				if (!context.erlaubeAnonym) return callback(false, 401, "Nicht angemeldet");
				return callback(true);
			}
			const aktive = context.wsCounts.get(session.user.id) ?? 0;
			if (!darfVerbinden(aktive, context.auth.maxSessionsPerUser)) {
				return callback(false, 429, "Zu viele parallele Verbindungen");
			}
			callback(true);
		},
	});

	wss.on("connection", async (ws: SocketConnection, request: IncomingMessage) => {
		const user = userFromRequest(context, request);
		if (user) context.wsCounts.set(user.id, (context.wsCounts.get(user.id) ?? 0) + 1);

		const send = (message: Record<string, unknown>): void => {
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
		};

		let hosted: HostedSession;
		try {
			hosted = await sessionHost.open(send, user);
		} catch (error) {
			send({
				type: "notify",
				level: "error",
				message: `Session konnte nicht starten: ${error instanceof Error ? error.message : String(error)}`,
			});
			ws.close();
			return;
		}

		ws.on("message", async (data: { toString(): string }) => {
			let message: ClientMessage;
			try {
				message = JSON.parse(data.toString());
			} catch {
				return; // Kaputte Nachrichten fallen still unter den Tisch.
			}
			// Neuer Thread: Session wegwerfen und auf derselben Verbindung neu aufbauen.
			if (message?.type === "new_thread") {
				try {
					await hosted.dispose();
					hosted = await sessionHost.open(send, user);
				} catch (error) {
					send({
						type: "notify",
						level: "error",
						message: `Neuer Thread fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
					});
				}
				return;
			}
			// Alten Thread öffnen: Session-Datei wiederherstellen (mit Kontext).
			if (message?.type === "thread_open") {
				try {
					await hosted.dispose();
					hosted = await sessionHost.open(send, user, message.threadId);
				} catch (error) {
					send({
						type: "notify",
						level: "error",
						message: `Thread konnte nicht geöffnet werden: ${error instanceof Error ? error.message : String(error)}`,
					});
				}
				return;
			}
			await hosted.handleMessage(message);
		});
		ws.on("close", () => {
			if (user) {
				const aktive = (context.wsCounts.get(user.id) ?? 1) - 1;
				if (aktive <= 0) context.wsCounts.delete(user.id);
				else context.wsCounts.set(user.id, aktive);
			}
			void hosted.dispose();
		});
	});

	await new Promise<void>((resolveListen) => server.listen(port, host, resolveListen));

	process.stderr.write(`Syntax Bot Web: http://${host}:${port}\n`);
	if (!erlaubeAnonym) {
		process.stderr.write("Öffentliches Binden aktiv — Anmeldung per Konto ist Pflicht.\n");
		if (!auth.secureCookie) {
			process.stderr.write("Hinweis: Für HTTPS-Betrieb SYNTAX_BOT_SECURE=1 setzen (Secure-Cookie).\n");
		}
	}
}

main().catch((error) => {
	process.stderr.write(`Webserver abgestürzt: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
