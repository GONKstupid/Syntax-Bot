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
 *  - Ohne OAuth-Konfiguration: Ein-Nutzer-Betrieb, bindet NUR auf localhost.
 *  - Mit GitHub-OAuth (SYNTAX_BOT_GITHUB_CLIENT_ID/SECRET): Multi-User,
 *    Login-Pflicht, darf auch öffentlich binden. HTTPS terminiert dann ein
 *    Reverse-Proxy (Caddy/nginx); bei HTTPS-Cookies SYNTAX_BOT_SECURE=1.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
	buildLoginUrl,
	clearSessionCookie,
	clientIp,
	darfVerbinden,
	exchangeCode,
	fetchGithubUser,
	oauthConfigFromEnv,
	parseCookieHeader,
	rateLimitOk,
	sessionCookie,
	SessionStore,
	type AuthConfig,
	type WebUser,
} from "./auth.ts";
import {
	defaultSessionHostOptions,
	SessionHost,
	type ClientMessage,
	type HostedSession,
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
const STATE_LIFETIME_MS = 10 * 60 * 1000;

/** Ab hier wird die App ausgeliefert — die Startseite »/« ist die Anmeldung. */
const ROUTEN_DATEI: Record<string, string> = {
	"/app": "/index.html",
	"/konto": "/konto.html",
};

/** Markierungen im login.html für den optionalen GitHub-Anmeldeblock. */
const OAUTH_BLOCK_MUSTER = /<!-- OAUTH-ANFANG -->[\s\S]*?<!-- OAUTH-ENDE -->\n?/;

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
	oauth: AuthConfig | null;
	sessions: SessionStore;
	/** Ausstehende OAuth-States (CSRF-Schutz) mit Ablaufzeit. */
	pendingStates: Map<string, number>;
	/** Aktive WebSocket-Verbindungen pro Nutzer-ID. */
	wsCounts: Map<string, number>;
	/** Rate-Limit-Zähler pro Client-IP. */
	rateCounter: Map<string, number[]>;
	trustProxy: boolean;
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
	if (!context.oauth) return undefined;
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
	if (pathname === "/") pathname = context.oauth ? "/index.html" : "/login.html";
	const filePath = normalize(join(uiDir, pathname));

	if (!filePath.startsWith(uiDir) || !existsSync(filePath)) {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Nicht gefunden.");
		return;
	}

	let inhalt: Buffer = await readFile(filePath);

	// Anmeldeseite: GitHub-Block nur zeigen, wenn OAuth konfiguriert ist;
	// sonst bleibt nur der Weg »Ohne Provider fortfahren«.
	if (pathname === "/login.html") {
		let html = inhalt.toString("utf8");
		if (context.oauth) {
			html = html.replace("<!-- OAUTH-ANFANG -->", "").replace("<!-- OAUTH-ENDE -->", "");
		} else {
			html = html.replace(OAUTH_BLOCK_MUSTER, "");
		}
		inhalt = Buffer.from(html, "utf8");
	}

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

/* --- OAuth-Routen ---------------------------------------------------------- */

function behandleLogin(context: ServerContext, request: IncomingMessage, response: ServerResponse): void {
	if (!context.oauth) return antworteText(response, 404, "OAuth ist nicht konfiguriert.");
	const ip = clientIp(request as never, context.trustProxy);
	if (!rateLimitOk(context.rateCounter, `login:${ip}`, Date.now(), 60000, 20)) {
		return antworteText(response, 429, "Zu viele Anmeldeversuche — bitte kurz warten.");
	}

	const state = randomBytes(16).toString("hex");
	context.pendingStates.set(state, Date.now() + STATE_LIFETIME_MS);
	response.writeHead(302, { location: buildLoginUrl(context.oauth, state) });
	response.end();
}

async function behandleCallback(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const oauth = context.oauth;
	if (!oauth) return antworteText(response, 404, "OAuth ist nicht konfiguriert.");

	const url = new URL(request.url ?? "/", "http://localhost");
	const state = url.searchParams.get("state") ?? "";
	const code = url.searchParams.get("code") ?? "";

	const ablauf = context.pendingStates.get(state);
	context.pendingStates.delete(state);
	if (!ablauf || ablauf < Date.now() || !code) {
		return antworteText(response, 400, "Ungültige oder abgelaufene Anmeldung. Bitte erneut versuchen.");
	}

	try {
		const accessToken = await exchangeCode(oauth, code);
		const user = await fetchGithubUser(oauth, accessToken);
		const session = context.sessions.create(user);
		response.writeHead(302, {
			location: "/app",
			"set-cookie": sessionCookie(session, oauth.secureCookie),
		});
		response.end();
	} catch (error) {
		antworteText(response, 502, `Anmeldung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function behandleLogout(context: ServerContext, request: IncomingMessage, response: ServerResponse): void {
	const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
	if (token) context.sessions.delete(token);
	response.writeHead(302, {
		location: "/",
		"set-cookie": clearSessionCookie(context.oauth?.secureCookie ?? false),
	});
	response.end();
}

/* --- Hauptprogramm --------------------------------------------------------- */

async function main(): Promise<void> {
	const { port, host } = parseArgs(process.argv.slice(2));
	const options = defaultSessionHostOptions();
	const oauth = oauthConfigFromEnv();

	const runtimeDir = join(process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot"), "runtime");
	if (!existsSync(runtimeDir)) {
		process.stderr.write("Pi-Runtime fehlt. Bitte zuerst »node scripts/bootstrap.mjs« ausführen.\n");
		process.exit(1);
	}

	if (!istLoopback(host) && !oauth) {
		process.stderr.write(
			"FEHLER: Öffentliches Binden ist ohne OAuth nicht erlaubt.\n" +
				"Setze SYNTAX_BOT_GITHUB_CLIENT_ID und SYNTAX_BOT_GITHUB_CLIENT_SECRET\n" +
				"(sowie SYNTAX_BOT_PUBLIC_URL), oder binde auf 127.0.0.1.\n",
		);
		process.exit(1);
	}

	const context: ServerContext = {
		oauth,
		sessions: new SessionStore(),
		pendingStates: new Map(),
		wsCounts: new Map(),
		rateCounter: new Map(),
		trustProxy: process.env.SYNTAX_BOT_TRUST_PROXY === "1",
	};
	const sessionHost = new SessionHost(options);

	const server = createServer((request, response) => {
		const pfad = new URL(request.url ?? "/", "http://localhost").pathname;

		try {
			if (pfad === "/auth/login") return behandleLogin(context, request, response);
			if (pfad === "/auth/callback") {
				return void behandleCallback(context, request, response).catch(() => antworteText(response, 500, "Serverfehler bei der Anmeldung."));
			}
			if (pfad === "/auth/logout") return behandleLogout(context, request, response);

			const nutzer = userFromRequest(context, request);
			// Mit OAuth kommt nur eine gültige Session zur App — statische
			// Bausteine (CSS, JS, Schriften) braucht aber schon die Anmeldeseite.
			const istStatik = /\.[a-z0-9]+$/i.test(pfad);
			if (context.oauth && !nutzer && !istStatik) {
				return void serveStatic(request, response, context, "/login.html");
			}
			// Angemeldet auf der Startseite → direkt zur App.
			if (pfad === "/" && context.oauth && nutzer) {
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
			if (!context.oauth) return callback(true);
			const token = parseCookieHeader(info.req.headers.cookie)[SESSION_COOKIE_NAME];
			const session = context.sessions.get(token);
			if (!session) return callback(false, 401, "Nicht angemeldet");
			const aktive = context.wsCounts.get(session.user.id) ?? 0;
			if (!darfVerbinden(aktive, context.oauth.maxSessionsPerUser)) {
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
	if (oauth) {
		process.stderr.write(`OAuth aktiv (GitHub), öffentlicher Basis-URL: ${oauth.publicUrl}\n`);
		if (!oauth.secureCookie) {
			process.stderr.write("Hinweis: Für HTTPS-Betrieb SYNTAX_BOT_SECURE=1 setzen (Secure-Cookie).\n");
		}
	} else if (!istLoopback(host)) {
		// Durch die Prüfung oben unerreichbar — zur Absicherung dennoch Warnung.
		process.stderr.write("WARNUNG: Der Server ist übers Netz erreichbar.\n");
	}
}

main().catch((error) => {
	process.stderr.write(`Webserver abgestürzt: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
