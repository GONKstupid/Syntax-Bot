/**
 * Konto-Credentials — Anmeldedaten für native Modell-Anbieter pro Konto.
 *
 * Pi legt API-Keys und OAuth-Tokens normalerweise in der globalen auth.json
 * der geteilten Laufzeit ab — auf einem Mehrnutzer-Server würden sich die
 * Konten dort gegenseitig sehen. Deshalb bekommt jedes Konto einen eigenen
 * CredentialStore (Schnittstelle aus pi-ai), der als JSON-Datei unter
 * `~/.syntax-bot/web-credentials/` persistiert wird. Der Store wird dem
 * ModelRuntime der Session übergeben; damit „merkt" sich das Konto seine
 * Anmeldungen (API-Key UND Browser-OAuth) über Server-Neustarts hinweg.
 *
 * Anonyme Verbindungen bekommen einen reinen In-Memory-Store (nichts wird
 * gemerkt — das ist gewollt).
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Strukturkompatibel zu Credential/CredentialInfo aus pi-ai (bewusst ohne Import). */
export interface KontoCredential {
	type: "api_key" | "oauth";
	[key: string]: unknown;
}

export interface KontoCredentialInfo {
	providerId: string;
	type: KontoCredential["type"];
}

/** Strukturkompatibel zu CredentialStore aus pi-ai. */
export interface CredentialStoreSchnitt {
	read(providerId: string): Promise<KontoCredential | undefined>;
	list(): Promise<readonly KontoCredentialInfo[]>;
	modify(
		providerId: string,
		fn: (current: KontoCredential | undefined) => Promise<KontoCredential | undefined>,
	): Promise<KontoCredential | undefined>;
	delete(providerId: string): Promise<void>;
}

export class KontoCredentialStore implements CredentialStoreSchnitt {
	/** Bei null bleibt der Store rein im Arbeitsspeicher (anonyme Sessions). */
	private readonly datei: string | null;
	/** In-Memory-Haltung, wenn keine Datei hinterlegt ist. */
	private readonly speicher = new Map<string, KontoCredential>();
	/** Serialisierte Schreibzugriffe pro Provider — wie von pi-ai verlangt. */
	private readonly sperren = new Map<string, Promise<void>>();

	constructor(datei: string | null) {
		this.datei = datei;
	}

	private async lesen(): Promise<Record<string, KontoCredential>> {
		if (!this.datei) return Object.fromEntries(this.speicher);
		try {
			const roh = await readFile(this.datei, "utf8");
			const daten = JSON.parse(roh) as Record<string, KontoCredential>;
			return daten && typeof daten === "object" ? daten : {};
		} catch {
			return {};
		}
	}

	private async schreiben(daten: Record<string, KontoCredential>): Promise<void> {
		if (!this.datei) {
			this.speicher.clear();
			for (const [providerId, credential] of Object.entries(daten)) this.speicher.set(providerId, credential);
			return;
		}
		await mkdir(dirname(this.datei), { recursive: true });
		await writeFile(this.datei, JSON.stringify(daten, null, "\t"), "utf8");
		try {
			await chmod(this.datei, 0o600);
		} catch {
			// Windows ignoriert Unix-Modi — kein Fehler.
		}
	}

	async read(providerId: string): Promise<KontoCredential | undefined> {
		return (await this.lesen())[providerId];
	}

	async list(): Promise<readonly KontoCredentialInfo[]> {
		const alle = await this.lesen();
		return Object.entries(alle).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		providerId: string,
		fn: (current: KontoCredential | undefined) => Promise<KontoCredential | undefined>,
	): Promise<KontoCredential | undefined> {
		return this.mitSperre(providerId, async () => {
			const alle = await this.lesen();
			const neu = await fn(alle[providerId]);
			if (neu === undefined) return alle[providerId];
			alle[providerId] = neu;
			await this.schreiben(alle);
			return neu;
		});
	}

	async delete(providerId: string): Promise<void> {
		await this.mitSperre(providerId, async () => {
			const alle = await this.lesen();
			if (!(providerId in alle)) return;
			delete alle[providerId];
			await this.schreiben(alle);
		});
	}

	/** Serialisiert Aktionen pro Provider — read-modify-write bleibt atomar. */
	private mitSperre<T>(providerId: string, aktion: () => Promise<T>): Promise<T> {
		const vorher = this.sperren.get(providerId) ?? Promise.resolve(undefined);
		const laufend = vorher.then(aktion, aktion);
		this.sperren.set(providerId, laufend.then(
			() => undefined,
			() => undefined,
		));
		return laufend;
	}
}

/** Dateipfad des Credential-Stores für ein Konto. */
export function credentialDateiFuer(verzeichnis: string, kontoId: string): string {
	return `${verzeichnis.replace(/[\\/]+$/, "")}/${kontoId}.json`;
}
