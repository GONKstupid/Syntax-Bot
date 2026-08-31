/**
 * OAuth (GitHub) und Session-Verwaltung für den Web-Server.
 *
 * Ablauf (Authorization Code Flow, serverseitig):
 *   1. Browser → /auth/login    → Umleitung zu GitHub (state als CSRF-Schutz)
 *   2. GitHub  → /auth/callback → Code gegen Token tauschen, Nutzer laden,
 *                                 HttpOnly-Session-Cookie setzen
 *   3. /auth/logout löscht die Session.
 *
 * Konfiguration über Umgebungsvariablen:
 *   SYNTAX_BOT_GITHUB_CLIENT_ID / SYNTAX_BOT_GITHUB_CLIENT_SECRET
 *   SYNTAX_BOT_PUBLIC_URL       — öffentliche Basis-URL (z. B. https://bot.example.de)
 *   SYNTAX_BOT_SECURE=1         — Cookie mit Secure-Attribut (hinter HTTPS-Proxy)
 *   SYNTAX_BOT_MAX_SESSIONS     — max. parallele WS-Verbindungen pro Nutzer (Standard 2)
 *
 * Ohne Client-ID ist OAuth deaktiviert; der Server bleibt dann ein
 * Ein-Nutzer-Dienst auf localhost (das Binden ins Netz wird verweigert).
 */

import { randomBytes } from "node:crypto";

export interface AuthConfig {
	clientId: string;
	clientSecret: string;
	/** Öffentliche Basis-URL ohne abschließenden Schrägstrich. */
	publicUrl: string;
	secureCookie: boolean;
	maxSessionsPerUser: number;
	/** Für Tests austauschbar. */
	githubAuthorizeUrl?: string;
	githubTokenUrl?: string;
	githubUserUrl?: string;
}

export interface WebUser {
	id: string;
	login: string;
}

export interface WebSession {
	token: string;
	user: WebUser;
	createdAt: number;
}

const SESSION_COOKIE = "syntax-bot-session";
const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";

/** OAuth ist genau dann aktiv, wenn beide GitHub-Werte gesetzt sind. */
export function oauthConfigFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig | null {
	const clientId = env.SYNTAX_BOT_GITHUB_CLIENT_ID?.trim();
	const clientSecret = env.SYNTAX_BOT_GITHUB_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) return null;

	const publicUrl = (env.SYNTAX_BOT_PUBLIC_URL?.trim() || "http://127.0.0.1:4711").replace(/\/+$/, "");
	const maxSessions = Math.max(1, Number(env.SYNTAX_BOT_MAX_SESSIONS) || 2);
	return {
		clientId,
		clientSecret,
		publicUrl,
		secureCookie: env.SYNTAX_BOT_SECURE === "1",
		maxSessionsPerUser: maxSessions,
	};
}

/* --- OAuth-URLs ---------------------------------------------------------- */

export function buildLoginUrl(config: AuthConfig, state: string): string {
	const base = config.githubAuthorizeUrl ?? GITHUB_AUTHORIZE;
	const url = new URL(base);
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", `${config.publicUrl}/auth/callback`);
	url.searchParams.set("scope", "read:user");
	url.searchParams.set("state", state);
	return url.toString();
}

/** Tauscht den Authorization Code gegen ein GitHub-Access-Token. */
export async function exchangeCode(config: AuthConfig, code: string): Promise<string> {
	const antwort = await fetch(config.githubTokenUrl ?? GITHUB_TOKEN, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: `${config.publicUrl}/auth/callback`,
		}),
	});
	if (!antwort.ok) throw new Error(`GitHub-Token-Austausch fehlgeschlagen (HTTP ${antwort.status}).`);
	const daten = (await antwort.json()) as { access_token?: string; error_description?: string };
	if (!daten.access_token) {
		throw new Error(daten.error_description ?? "GitHub hat kein Access-Token zurückgegeben.");
	}
	return daten.access_token;
}

/** Lädt den GitHub-Nutzer zum Access-Token. */
export async function fetchGithubUser(config: AuthConfig, accessToken: string): Promise<WebUser> {
	const antwort = await fetch(config.githubUserUrl ?? GITHUB_USER, {
		headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
	});
	if (!antwort.ok) throw new Error(`GitHub-Nutzer konnte nicht geladen werden (HTTP ${antwort.status}).`);
	const daten = (await antwort.json()) as { id?: number; login?: string };
	if (!daten.id || !daten.login) throw new Error("GitHub-Antwort enthält keine Nutzerkennung.");
	return { id: String(daten.id), login: daten.login };
}

/* --- Sessions ------------------------------------------------------------ */

export class SessionStore {
	private readonly sessions = new Map<string, WebSession>();

	create(user: WebUser): WebSession {
		const session: WebSession = { token: randomBytes(32).toString("hex"), user, createdAt: Date.now() };
		this.sessions.set(session.token, session);
		return session;
	}

	get(token: string | undefined): WebSession | undefined {
		if (!token) return undefined;
		return this.sessions.get(token);
	}

	delete(token: string): void {
		this.sessions.delete(token);
	}

	/** Anzahl aktiver WebSocket-Verbindungen eines Nutzers. */
	countForUser(userId: string): number {
		let anzahl = 0;
		for (const session of this.sessions.values()) {
			if (session.user.id === userId) anzahl++;
		}
		return anzahl;
	}
}

/** Prüft, ob ein Nutzer noch eine weitere Verbindung öffnen darf. */
export function darfVerbinden(aktiveVerbindungen: number, maximum: number): boolean {
	return aktiveVerbindungen < maximum;
}

/* --- Cookies -------------------------------------------------------------- */

export function parseCookieHeader(header: string | undefined): Record<string, string> {
	const kekse: Record<string, string> = {};
	if (!header) return kekse;
	for (const teil of header.split(";")) {
		const trenner = teil.indexOf("=");
		if (trenner < 0) continue;
		const name = teil.slice(0, trenner).trim();
		const wert = teil.slice(trenner + 1).trim();
		if (name) kekse[name] = decodeURIComponent(wert);
	}
	return kekse;
}

export function sessionTokenFromHeader(header: string | undefined): string | undefined {
	return parseCookieHeader(header)[SESSION_COOKIE];
}

export function sessionCookie(session: WebSession, secure: boolean): string {
	const teile = [
		`${SESSION_COOKIE}=${session.token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
	];
	if (secure) teile.push("Secure");
	return teile.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
	const teile = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
	if (secure) teile.push("Secure");
	return teile.join("; ");
}

/* --- Rate-Limit ----------------------------------------------------------- */

/**
 * Schiebefenster-Zähler pro Schlüssel (IP). `zaehler` darf der Server
 * pro Prozess wiederverwenden; die Funktion ist rein und damit testbar.
 */
export function rateLimitOk(
	zaehler: Map<string, number[]>,
	schluessel: string,
	jetzt: number,
	fensterMs: number,
	maxAnfragen: number,
): boolean {
	const eintraege = (zaehler.get(schluessel) ?? []).filter((zeit) => jetzt - zeit < fensterMs);
	if (eintraege.length >= maxAnfragen) {
		zaehler.set(schluessel, eintraege);
		return false;
	}
	eintraege.push(jetzt);
	zaehler.set(schluessel, eintraege);
	return true;
}

/** Client-IP aus den Headern — X-Forwarded-For nur auswerten, wenn erlaubt. */
export function clientIp(request: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }, vertraueProxy: boolean): string {
	if (vertraueProxy) {
		const weiterleitung = request.headers["x-forwarded-for"];
		const erste = Array.isArray(weiterleitung) ? weiterleitung[0] : weiterleitung;
		if (erste) return erste.split(",")[0].trim();
	}
	return request.socket.remoteAddress ?? "unbekannt";
}
