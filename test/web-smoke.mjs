/**
 * Manueller Smoke-Test für den Web-Server (nicht Teil der Suite).
 *
 * Erwartet einen laufenden Server, prüft:
 *  1. HTTP liefert die Oberfläche aus (GET /app → index.html, inkl.
 *     Aktionsleiste und Threads-Overlay; GET / ist die Anmeldeseite
 *     mit Anmelden/Registrieren-Formular)
 *  2. Registrierung/Login/Logout über /auth/* (Cookie-Fluss)
 *  3. WebSocket begrüßt mit "ready" (+ Modell-Warnung); mit Konto
 *     antwortet thread_list sauber
 *  4. Ein Slash-Command (/syntax-fix) meldet den Modus per "status"
 *  5. BYOM: ungültige Konfiguration und unerreichbarer Endpunkt
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
pruefe("Anmeldeseite hat Anmelden/Registrieren-Formular",
	startHtml.includes("umschalter-anmelden") && startHtml.includes("umschalter-registrieren")
	&& startHtml.includes("feld-passwort") && startHtml.includes("Ohne Konto fortfahren"));

const antwort = await fetch(`${basis}/app`);
const html = await antwort.text();
pruefe("GET /app liefert 200", antwort.status === 200, `Status ${antwort.status}`);
pruefe("GET /app liefert die UI", html.includes("Syntax Bot") && html.includes("verlauf"));
pruefe("UI enthält Onboarding und Kopf-Aktionen", html.includes("onboarding-overlay") && html.includes("neu-knopf") && html.includes("menue-knopf"));
pruefe("UI enthält das Threads-Overlay", html.includes("threads-overlay") && html.includes("threads-liste"));
pruefe("Aktionsleiste unter der Eingabe", html.includes("fuss-werkzeug") && html.includes("modell-knopf") && html.includes("kontext-anzeige"));
pruefe("LRS-Schrift ist entfernt", !html.includes("opendyslexic") && !html.includes("schrift-lrs"));

// 2. Konto: Registrierung, Anmeldung und Abmeldung über /auth/*.
const testNutzer = `rauch_${Date.now()}`;
const kontoDaten = { nutzername: testNutzer, email: `${testNutzer}@example.de`, passwort: "geheimnis1" };

const registrierung = await fetch(`${basis}/auth/register`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(kontoDaten),
});
pruefe("POST /auth/register legt ein Konto an", registrierung.status === 200, `Status ${registrierung.status}`);
const cookie = (registrierung.headers.get("set-cookie") ?? "").split(";")[0];
pruefe("Registrierung setzt das Session-Cookie", cookie.startsWith("syntax-bot-session="));

const duplikat = await fetch(`${basis}/auth/register`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(kontoDaten),
});
pruefe("Doppelte Registrierung wird abgelehnt", duplikat.status === 400);

const fehllogin = await fetch(`${basis}/auth/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ kennung: testNutzer, passwort: "falsch123" }),
});
pruefe("Login mit falschem Passwort liefert 401", fehllogin.status === 401);

const login = await fetch(`${basis}/auth/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ kennung: testNutzer, passwort: kontoDaten.passwort }),
});
pruefe("Login mit richtigen Daten liefert 200", login.status === 200);
const loginCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const abmelden = await fetch(`${basis}/auth/logout`, {
	headers: { cookie: loginCookie },
	redirect: "manual",
});
pruefe("GET /auth/logout leitet weiter", abmelden.status === 302, `Status ${abmelden.status}`);

// 3./4. WebSocket: ready empfangen (mit Konto), thread_list, /syntax-fix.
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
const nachrichten = [];
const warteAuf = (praedikat, ms = 15000, abIndex = 0) =>
	new Promise((resolve) => {
		const start = Date.now();
		const timer = setInterval(() => {
			const treffer = nachrichten.slice(abIndex).find(praedikat);
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

const bereit = await warteAuf((m) => m.type === "ready");
pruefe("ready nach Verbindungsaufbau", Boolean(bereit));
pruefe("ready meldet den Kontonutzer", bereit?.user === testNutzer, JSON.stringify(bereit));

ws.send(JSON.stringify({ type: "thread_list" }));
const threads = await warteAuf((m) => m.type === "threads");
pruefe("thread_list antwortet mit leerer Liste", Array.isArray(threads?.threads) && threads.threads.length === 0);

ws.send(JSON.stringify({ type: "thread_open", threadId: "gibt-es-nicht" }));
const hinweisThread = await warteAuf((m) => m.type === "notify" && m.level === "warning" && /nicht mehr verfügbar/.test(m.message ?? ""));
pruefe("Unbekannter Thread meldet Hinweis", Boolean(hinweisThread));
const neuesReady = await warteAuf((m) => m.type === "ready", 15000, nachrichten.indexOf(bereit) + 1);
pruefe("Unbekannter Thread startet eine neue Sitzung", Boolean(neuesReady));

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
