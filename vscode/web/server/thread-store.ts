/**
 * Thread-Store — Gesprächsverlauf je Konto.
 *
 * Pro Konto wird ein Index geführt: Thread-ID, Titel, Zeitstempel und die
 * zugehörige Pi-Session-Datei. Beim Öffnen eines alten Threads wird die
 * Session-Datei mit SessionManager.open wiederhergestellt — der Thread ist
 * dann mit vollem Modell-Kontext fortsetzbar (wie session/load im IDE-Adapter).
 *
 * Anonyme Verbindungen (ohne Konto) bekommen keine Einträge.
 * Gespeichert unter `~/.syntax-bot/web-threads.json`.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ThreadEintrag {
	id: string;
	titel: string;
	erstellt: number;
	aktualisiert: number;
	/** Pfad zur Pi-Session-Datei (JSONL) — Quelle für das Fortsetzen. */
	sessionDatei: string;
}

type StoreInhalt = Record<string, ThreadEintrag[]>;

export class ThreadStore {
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

	/** Neueste Threads zuerst. */
	async liste(kontoId: string): Promise<ThreadEintrag[]> {
		const alle = await this.lesen();
		return [...(alle[kontoId] ?? [])].sort((a, b) => b.aktualisiert - a.aktualisiert);
	}

	async hole(kontoId: string, threadId: string): Promise<ThreadEintrag | undefined> {
		return (await this.liste(kontoId)).find((eintrag) => eintrag.id === threadId);
	}

	/** Legt an oder aktualisiert (gleiche ID = Titel/Zeitstempel/Datei nachziehen). */
	async sichere(kontoId: string, eintrag: ThreadEintrag): Promise<void> {
		const alle = await this.lesen();
		const liste = alle[kontoId] ?? [];
		const index = liste.findIndex((e) => e.id === eintrag.id);
		if (index >= 0) liste[index] = eintrag;
		else liste.push(eintrag);
		alle[kontoId] = liste;
		await this.schreiben(alle);
	}

	async loesche(kontoId: string, threadId: string): Promise<ThreadEintrag | undefined> {
		const alle = await this.lesen();
		const liste = alle[kontoId] ?? [];
		const gefiltert = liste.filter((eintrag) => eintrag.id !== threadId);
		if (gefiltert.length === liste.length) return undefined;
		const entfernt = liste.find((eintrag) => eintrag.id === threadId);
		alle[kontoId] = gefiltert;
		await this.schreiben(alle);
		return entfernt;
	}
}
