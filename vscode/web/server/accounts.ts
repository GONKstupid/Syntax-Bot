/**
 * Konto-Store — Registrierung und Anmeldung mit Nutzername, E-Mail und
 * Passwort (ersetzt die frühere GitHub-OAuth-Anmeldung).
 *
 * Konten liegen unter `~/.syntax-bot/web-accounts.json`. Passwörter werden
 * mit scrypt (eigenes Salt pro Konto) gehasht und nur als Hash abgelegt;
 * der Vergleich läuft timing-sicher über timingSafeEqual.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function scryptAsync(passwort: string, salt: string, keylen: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scryptCallback(passwort, salt, keylen, (fehler, abgeleitet) => {
			if (fehler) reject(fehler);
			else resolve(abgeleitet);
		});
	});
}

/** Ein gespeichertes Konto. */
export interface WebKonto {
	id: string;
	nutzername: string;
	email: string;
	passwortSalt: string;
	passwortHash: string;
	createdAt: number;
}

/** Öffentliche Ansicht eines Kontos — ohne Hash und Salt. */
export interface KontoInfo {
	id: string;
	nutzername: string;
	email: string;
	createdAt: number;
}

const NUTZERNAME_MUSTER = /^[a-zA-Z0-9äöüÄÖÜß_.-]{3,32}$/;
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** scrypt-Parameter bewusst konservativ — der Server soll lokal flott bleiben. */
const SCRYPT_KEYLEN = 64;

export function kontoInfoVon(konto: WebKonto): KontoInfo {
	return { id: konto.id, nutzername: konto.nutzername, email: konto.email, createdAt: konto.createdAt };
}

export async function hashPasswort(passwort: string, salt: string): Promise<string> {
	const abgeleitet = await scryptAsync(passwort, salt, SCRYPT_KEYLEN);
	return Buffer.from(abgeleitet).toString("hex");
}

/** Timing-sicherer Vergleich zweier Hex-Hashes. */
export function pruefeHash(erwartetHex: string, berechnetHex: string): boolean {
	const a = Buffer.from(erwartetHex, "hex");
	const b = Buffer.from(berechnetHex, "hex");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export class KontoStore {
	private readonly datei: string;

	constructor(datei: string) {
		this.datei = datei;
	}

	private async lesen(): Promise<WebKonto[]> {
		try {
			const roh = await readFile(this.datei, "utf8");
			const daten = JSON.parse(roh);
			return Array.isArray(daten) ? (daten as WebKonto[]) : [];
		} catch {
			return [];
		}
	}

	private async schreiben(konten: WebKonto[]): Promise<void> {
		await mkdir(dirname(this.datei), { recursive: true });
		await writeFile(this.datei, JSON.stringify(konten, null, "\t"), "utf8");
		try {
			await chmod(this.datei, 0o600);
		} catch {
			// Windows ignoriert Unix-Modi — kein Fehler.
		}
	}

	async hole(id: string): Promise<WebKonto | undefined> {
		return (await this.lesen()).find((konto) => konto.id === id);
	}

	private async finde(kennung: string): Promise<WebKonto | undefined> {
		const klein = kennung.trim().toLowerCase();
		return (await this.lesen()).find(
			(konto) => konto.nutzername.toLowerCase() === klein || konto.email.toLowerCase() === klein,
		);
	}

	/** Legt ein Konto an. Wirft mit deutscher Meldung bei ungültigen Angaben. */
	async registrieren(nutzername: string, email: string, passwort: string): Promise<WebKonto> {
		const name = nutzername.trim();
		const adresse = email.trim();
		if (!NUTZERNAME_MUSTER.test(name)) {
			throw new Error("Der Nutzername muss 3–32 Zeichen lang sein (Buchstaben, Ziffern, äöüß, Punkt, _ oder -).");
		}
		if (!EMAIL_MUSTER.test(adresse)) {
			throw new Error("Die E-Mail-Adresse ist ungültig.");
		}
		if (passwort.length < 8) {
			throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
		}

		const konten = await this.lesen();
		if (konten.some((konto) => konto.nutzername.toLowerCase() === name.toLowerCase())) {
			throw new Error("Dieser Nutzername ist bereits vergeben.");
		}
		if (konten.some((konto) => konto.email.toLowerCase() === adresse.toLowerCase())) {
			throw new Error("Diese E-Mail-Adresse ist bereits registriert.");
		}

		const salt = randomBytes(16).toString("hex");
		const konto: WebKonto = {
			id: randomBytes(12).toString("hex"),
			nutzername: name,
			email: adresse,
			passwortSalt: salt,
			passwortHash: await hashPasswort(passwort, salt),
			createdAt: Date.now(),
		};
		konten.push(konto);
		await this.schreiben(konten);
		return konto;
	}

	/** Prüft Kennung (Nutzername oder E-Mail) + Passwort; liefert das Konto. */
	async anmelden(kennung: string, passwort: string): Promise<WebKonto> {
		const konto = await this.finde(kennung);
		if (!konto) throw new Error("Nutzername/E-Mail oder Passwort ist falsch.");
		const berechnet = await hashPasswort(passwort, konto.passwortSalt);
		if (!pruefeHash(konto.passwortHash, berechnet)) {
			throw new Error("Nutzername/E-Mail oder Passwort ist falsch.");
		}
		return konto;
	}
}
