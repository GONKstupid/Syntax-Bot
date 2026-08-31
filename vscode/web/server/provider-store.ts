/**
 * Provider-Store — gespeicherte Modell-Anbieter je Konto.
 *
 * Anmeldestatus (GitHub-OAuth) und Provider-Konfiguration sind unabhängig:
 * Ein Konto kann jederzeit Provider anlegen, ändern oder löschen — auch ohne
 * angemeldet zu sein (dann zählt das lokale Standard-Konto). Gespeichert wird
 * unter `~/.syntax-bot/web-providers.json`, ein Eintrag pro Provider.
 *
 * Hinweis: Die API-Schlüssel liegen dabei im Klartext in einer lokalen Datei
 * (Dateirechte 0600, soweit vom Dateisystem unterstützt). Das ist bewusst so:
 * Die Konfiguration soll einen Server-Neustart überleben.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredProvider {
	providerId: string;
	displayName: string;
	baseUrl: string;
	apiKey: string;
	modelId: string;
	savedAt: number;
	/** Anmeldeweg — ältere Einträge ohne Feld gelten als „custom“. */
	art?: "custom" | "api" | "oauth";
}

/** Konto-Kennung: angemeldete Nutzer über ihre ID, sonst das Standard-Konto. */
export function kontoIdVon(user?: { id: string }): string {
	return user ? `konto-${user.id.replace(/[^a-zA-Z0-9_-]/g, "")}` : "default";
}

type StoreInhalt = Record<string, StoredProvider[]>;

export class ProviderStore {
	private readonly datei: string;

	constructor(datei: string) {
		this.datei = datei;
	}

	private async lesen(): Promise<StoreInhalt> {
		try {
			const roh = await readFile(this.datei, "utf8");
			const daten = JSON.parse(roh) as StoreInhalt;
			return daten && typeof daten === "object" ? daten : {};
		} catch {
			return {};
		}
	}

	private async schreiben(daten: StoreInhalt): Promise<void> {
		await mkdir(dirname(this.datei), { recursive: true });
		await writeFile(this.datei, JSON.stringify(daten, null, "\t"), "utf8");
		try {
			await chmod(this.datei, 0o600);
		} catch {
			// Windows ignoriert Unix-Modi — kein Fehler.
		}
	}

	async liste(kontoId: string): Promise<StoredProvider[]> {
		const alle = await this.lesen();
		return alle[kontoId] ?? [];
	}

	/** Legt an oder ersetzt (gleiche providerId = Aktualisierung). */
	async speichere(kontoId: string, eintrag: Omit<StoredProvider, "savedAt">): Promise<StoredProvider> {
		const alle = await this.lesen();
		const liste = alle[kontoId] ?? [];
		const gespeichert: StoredProvider = { ...eintrag, savedAt: Date.now() };
		const vorhandenerIndex = liste.findIndex((p) => p.providerId === eintrag.providerId);
		if (vorhandenerIndex >= 0) liste[vorhandenerIndex] = gespeichert;
		else liste.push(gespeichert);
		alle[kontoId] = liste;
		await this.schreiben(alle);
		return gespeichert;
	}

	async loesche(kontoId: string, providerId: string): Promise<boolean> {
		const alle = await this.lesen();
		const liste = alle[kontoId] ?? [];
		const gefiltert = liste.filter((p) => p.providerId !== providerId);
		if (gefiltert.length === liste.length) return false;
		alle[kontoId] = gefiltert;
		await this.schreiben(alle);
		return true;
	}

	async hole(kontoId: string, providerId: string): Promise<StoredProvider | undefined> {
		return (await this.liste(kontoId)).find((p) => p.providerId === providerId);
	}

	/** Der zuerst gespeicherte Provider — dient als Standard beim Session-Start. */
	async erster(kontoId: string): Promise<StoredProvider | undefined> {
		const liste = await this.liste(kontoId);
		return liste[0];
	}
}
