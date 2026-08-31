/**
 * Manueller Smoke-Test für den Web-Server (nicht Teil der Suite).
 *
 * Erwartet einen laufenden Server, prüft:
 *  1. HTTP liefert die Oberfläche aus (GET /app → index.html, inkl.
 *     Aktionsleiste; GET / ist die Anmeldeseite)
 *  2. WebSocket begrüßt mit "ready" (+ Modell-Warnung)
 *  3. Ein Slash-Command (/syntax-fix) meldet den Modus per "status"
 *  4. BYOM: ungültige Konfiguration und unerreichbarer Endpunkt
 *     liefern Fehler-Hinweise statt Absturz
 *
 * Aufruf: node test/web-smoke.mjs [port]
 */

import WebSocket from "ws";

const port = Number(process.argv[2] || 4719);
const basis = `http://127.0.0.1:${port}`;

let fehler = 0;
function pruefe(name, bedingung, detail = "") {
	if (bedingung) {
		console.log(`  ok   ${name}`);
	} else {
		fehler++;
		console.log(`  FEHL ${name} ${detail}`);
	}
}

// 1. HTTP: Anmeldeseite und App-Oberfläche werden ausgeliefert.
const start = await fetch(`${basis}/`);
const startHtml = await start.text();
pruefe("GET / liefert 200", start.status === 200, `Status ${start.status}`);
pruefe("GET / liefert die Anmeldeseite", startHtml.includes("Syntax Bot"));

const antwort = await fetch(`${basis}/app`);
const html = await antwort.text();
pruefe("GET /app liefert 200", antwort.status === 200, `Status ${antwort.status}`);
pruefe("GET /app liefert die UI", html.includes("Syntax Bot") && html.includes("verlauf"));
pruefe("UI enthält Onboarding und Kopf-Aktionen", html.includes("onboarding-overlay") && html.includes("neu-knopf") && html.includes("menue-knopf"));
pruefe("Aktionsleiste unter der Eingabe", html.includes("fuss-werkzeug") && html.includes("modell-knopf") && html.includes("kontext-anzeige"));
pruefe("LRS-Schrift ist entfernt", !html.includes("opendyslexic") && !html.includes("schrift-lrs"));

// 2./3. WebSocket: ready empfangen, /syntax-fix schalten.
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const nachrichten = [];
const warteAuf = (praedikat, ms = 15000) =>
	new Promise((resolve) => {
		const start = Date.now();
		const timer = setInterval(() => {
			const treffer = nachrichten.find(praedikat);
			if (treffer || Date.now() - start > ms) {
				clearInterval(timer);
				resolve(treffer);
			}
		}, 50);
	});

ws.on("message", (roh) => nachrichten.push(JSON.parse(roh.toString())));
await new Promise((resolve, reject) => {
	ws.once("open", resolve);
	ws.once("error", reject);
});

pruefe("ready nach Verbindungsaufbau", Boolean(await warteAuf((m) => m.type === "ready")));

ws.send(JSON.stringify({ type: "user_message", text: "/syntax-fix" }));
const status = await warteAuf((m) => m.type === "status" && m.key === "syntax-bot-mode" && m.text);
pruefe("Modus-Status nach /syntax-fix", Boolean(status), JSON.stringify(nachrichten));

const hinweis = nachrichten.find((m) => m.type === "notify");
pruefe("Hinweis-Nachricht vorhanden", Boolean(hinweis));

// 4. BYOM: fehlerhafte Eingaben werden sauber beantwortet.
ws.send(JSON.stringify({ type: "byom_save", config: { baseUrl: "kein-url", modelId: "x" } }));
pruefe(
	"byom_save mit ungültiger URL liefert Fehler",
	Boolean(await warteAuf((m) => m.type === "notify" && m.level === "error" && /ungültig/.test(m.message ?? ""))),
);

ws.send(JSON.stringify({ type: "byom_test", baseUrl: "http://127.0.0.1:1", apiKey: "" }));
pruefe(
	"byom_test gegen unerreichbaren Endpunkt liefert Fehler",
	Boolean(await warteAuf((m) => m.type === "notify" && m.level === "error" && /Modell-Liste/.test(m.message ?? ""), 20000)),
);

ws.close();
console.log(fehler === 0 ? "\nSmoke-Test bestanden." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
