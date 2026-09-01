/**
 * Tests für den Thread-Store (web/server/thread-store.ts) und den
 * Pro-Konto-Credential-Store (web/server/konto-credentials.ts).
 *
 * Beide Stores sind einfache JSON-Dateien; geprüft werden Anlegen, Öffnen,
 * Löschen, Sortierung, Fehlerfälle (unbekannter Thread) und die
 * Serialisierung der Schreibzugriffe im Credential-Store.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadStore, type ThreadEintrag } from "../vscode/web/server/thread-store.ts";
import {
	credentialDateiFuer,
	KontoCredentialStore,
} from "../vscode/web/server/konto-credentials.ts";

function eintrag(ueberschreiben: Partial<ThreadEintrag>): ThreadEintrag {
	return {
		id: "thread-1",
		titel: "Erster Thread",
		erstellt: 1000,
		aktualisiert: 2000,
		sessionDatei: "/tmp/session-1.jsonl",
		...ueberschreiben,
	};
}

describe("ThreadStore", () => {
	async function neuerStore(): Promise<ThreadStore> {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-threads-"));
		return new ThreadStore(join(verzeichnis, "web-threads.json"));
	}

	it("legt an, öffnet und löscht Threads pro Konto", async () => {
		const store = await neuerStore();
		await store.sichere("konto-1", eintrag({}));
		assert.equal((await store.liste("konto-1")).length, 1);

		const geoeffnet = await store.hole("konto-1", "thread-1");
		assert.equal(geoeffnet?.titel, "Erster Thread");

		const entfernt = await store.loesche("konto-1", "thread-1");
		assert.equal(entfernt?.id, "thread-1");
		assert.equal((await store.liste("konto-1")).length, 0);
	});

	it("liefert für unbekannte Threads nichts zurück", async () => {
		const store = await neuerStore();
		assert.equal(await store.hole("konto-1", "gibt-es-nicht"), undefined);
		assert.equal(await store.loesche("konto-1", "gibt-es-nicht"), undefined);
		assert.deepEqual(await store.liste("anderes-konto"), []);
	});

	it("aktualisiert bestehende Einträge statt zu duplizieren", async () => {
		const store = await neuerStore();
		await store.sichere("konto-1", eintrag({}));
		await store.sichere("konto-1", eintrag({ titel: "Umbenannt", aktualisiert: 5000 }));
		const liste = await store.liste("konto-1");
		assert.equal(liste.length, 1);
		assert.equal(liste[0]?.titel, "Umbenannt");
	});

	it("sortiert neueste Threads zuerst und trennt Konten", async () => {
		const store = await neuerStore();
		await store.sichere("konto-1", eintrag({ id: "alt", aktualisiert: 100 }));
		await store.sichere("konto-1", eintrag({ id: "neu", aktualisiert: 900 }));
		await store.sichere("konto-2", eintrag({ id: "fremd", aktualisiert: 500 }));

		const liste = await store.liste("konto-1");
		assert.deepEqual(liste.map((e) => e.id), ["neu", "alt"]);
		// Ein anderes Konto sieht die fremden Threads nicht.
		assert.deepEqual((await store.liste("konto-2")).map((e) => e.id), ["fremd"]);
	});

	it("übersteht ein Neuladen der Datei", async () => {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-threads-"));
		const datei = join(verzeichnis, "web-threads.json");
		await new ThreadStore(datei).sichere("konto-1", eintrag({}));
		const geoeffnet = await new ThreadStore(datei).hole("konto-1", "thread-1");
		assert.equal(geoeffnet?.sessionDatei, "/tmp/session-1.jsonl");
	});

	it("entfernt alle Threads eines Kontos samt Session-Dateien", async () => {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-threads-"));
		const datei = join(verzeichnis, "web-threads.json");
		const sessionDatei = join(verzeichnis, "session-1.jsonl");
		await writeFile(sessionDatei, "{}", "utf8");
		const store = new ThreadStore(datei);
		await store.sichere("konto-1", eintrag({ sessionDatei }));
		// Fehlende Session-Datei darf das Löschen nicht aufhalten.
		await store.sichere("konto-1", eintrag({ id: "thread-2", sessionDatei: join(verzeichnis, "fehlt.jsonl") }));
		await store.sichere("konto-2", eintrag({ id: "thread-9" }));

		await store.loescheAlle("konto-1");
		assert.deepEqual(await store.liste("konto-1"), []);
		assert.equal(existsSync(sessionDatei), false);
		// Andere Konten bleiben unberührt.
		assert.equal((await store.liste("konto-2")).length, 1);
		// Nochmal löschen ist kein Fehler.
		await store.loescheAlle("konto-1");
	});
});

describe("KontoCredentialStore", () => {
	it("merkt sich Credentials in der Datei und löscht sie wieder", async () => {
		const verzeichnis = await mkdtemp(join(tmpdir(), "syntax-credentials-"));
		const datei = credentialDateiFuer(verzeichnis, "konto-1");
		assert.ok(datei.endsWith("konto-1.json"));

		const store = new KontoCredentialStore(datei);
		await store.modify("anthropic", async () => ({ type: "api_key", apiKey: "sk-test" }));
		assert.deepEqual(await store.read("anthropic"), { type: "api_key", apiKey: "sk-test" });
		assert.deepEqual(await store.list(), [{ providerId: "anthropic", type: "api_key" }]);

		// Ein zweiter Store (z. B. neue Session) liest dieselbe Datei.
		const neu = new KontoCredentialStore(datei);
		assert.equal((await neu.read("anthropic"))?.apiKey, "sk-test");

		await store.delete("anthropic");
		assert.equal(await store.read("anthropic"), undefined);
		assert.deepEqual(await store.list(), []);
	});

	it("bleibt ohne Datei rein im Arbeitsspeicher (anonyme Sessions)", async () => {
		const store = new KontoCredentialStore(null);
		await store.modify("openai", async () => ({ type: "api_key", apiKey: "k" }));
		assert.equal((await store.read("openai"))?.apiKey, "k");
		// Ein zweiter Store sieht davon nichts.
		assert.equal(await new KontoCredentialStore(null).read("openai"), undefined);
	});

	it("serialisiert Schreibzugriffe pro Provider", async () => {
		const store = new KontoCredentialStore(null);
		// Zwei parallele modify-Aufrufe dürfen sich nicht überschreiben:
		// jeder sieht den Stand des vorherigen.
		const aufrufe = Promise.all([
			store.modify("p", async () => ({ type: "api_key", schritt: 1 })),
			store.modify("p", async (aktuell) => ({ type: "api_key", schritt: 2, sahVorher: Boolean(aktuell) })),
		]);
		await aufrufe;
		const ende = await store.read("p");
		assert.equal(ende?.schritt, 2);
		assert.equal(ende?.sahVorher, true);
	});
});
