/**
 * Session-Verwaltung für den Web-Server.
 *
 * Die Anmeldung läuft über lokale Konten (Nutzername/E-Mail + Passwort,
 * siehe accounts.ts); GitHub-OAuth wurde 2026-09-01 entfernt. Nach der
 * Anmeldung setzt der Server ein HttpOnly-Session-Cookie:
 *
 *   POST /auth/register → Konto anlegen + Cookie
 *   POST /auth/login    → anmelden + Cookie
 *   GET  /auth/logout   → Session löschen
 *
 * Konfiguration über Umgebungsvariablen:
 *   SYNTAX_BOT_SECURE=1         — Cookie mit Secure-Attribut (hinter HTTPS-Proxy)
 *   SYNTAX_BOT_MAX_SESSIONS     — max. parallele WS-Verbindungen pro Nutzer (Standard 2)
 *
 * Ohne Anmeldung bleibt der Server ein Ein-Nutzer-Dienst auf localhost
 * (das Binden ins Netz verlangt SYNTAX_BOT_PUBLIC_BIND=1).
 */

import { randomBytes } from "node:crypto";

export interface WebAuthConfig {
	secureCookie: boolean;
	maxSessionsPerUser: number;
}

export interface WebUser {
	id: string;
	login: string;
	email?: string;
}

export interface WebSession {
	token: string;
	user: WebUser;
	createdAt: number;
}

const SESSION_COOKIE = "syntax-bot-session";

export function webAuthConfigFromEnv(env: Record<string, string | undefined> = process.env): WebAuthConfig {
	const maxSessions = Math.max(1, Number(env.SYNTAX_BOT_MAX_SESSIONS) || 2);
	return {
		secureCookie: env.SYNTAX_BOT_SECURE === "1",
		maxSessionsPerUser: maxSessions,
	};
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
