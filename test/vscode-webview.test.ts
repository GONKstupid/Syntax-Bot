/**
 * Testet die Chat-Webview-Logik (vscode/media/chat.js) in einem echten DOM
 * (jsdom): Nachrichten-Verarbeitung, Fußleisten-Menüs, „/“-Popup, Senden.
 * Damit ist die Webview nicht mehr der blinde Fleck zwischen Host und UI.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const repo = process.cwd();
const html = `<!DOCTYPE html><html><body>
<header class="kopf">
	<div class="marke">SYNTAX·BOT</div>
	<div class="kopfAktionen">
		<button id="neu" class="kopfKnopf">＋</button>
		<button id="punkte" class="kopfKnopf">⋯</button>
	</div>
</header>
<main class="verlauf" id="verlauf"></main>
<div id="berechtigungen"></div>
<footer class="fussLeiste">
	<textarea id="eingabe"></textarea>
	<div class="fussWerkzeug">
		<button id="anhang" class="fussKnopf">+</button>
		<span id="kontext" class="fussInfo"></span>
		<button id="modellKnopf" class="fussKnopf">Modell</button>
		<button id="thinkingKnopf" class="fussKnopf">Think</button>
		<button id="modusKnopf" class="fussKnopf">Modus</button>
		<button id="senden" class="fussKnopf senden">➤</button>
	</div>
</footer>
<div id="menue" hidden></div>
</body></html>`;

function webviewStarten(t: { after: (fn: () => void) => void } | undefined) {
	const gesendet: Array<Record<string, unknown>> = [];
	const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://localhost/" });
	if (t) t.after(() => dom.window.close());
	dom.window.acquireVsCodeApi = () => ({
		postMessage: (n: Record<string, unknown>) => {
			gesendet.push(n);
			return true;
		},
		getState: () => ({}),
		setState: () => {},
	});
	dom.window.eval(readFileSync(join(repo, "vscode", "media", "chat.js"), "utf8"));
	return {
		dom,
		gesendet,
		empfangen: (nachricht: Record<string, unknown>) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: nachricht })),
	};
}

const MODI = [
	{ id: "default", name: "Kein Modus", beschreibung: "" },
	{ id: "syntax-fix", name: "Syntax Fix", beschreibung: "" },
	{ id: "code-fix", name: "Code Fix", beschreibung: "" },
	{ id: "cleanup", name: "Cleanup", beschreibung: "" },
];

test("state-Nachricht füllt die Fußleisten-Menüs", (t) => {
	const { dom, empfangen } = webviewStarten(t);
	empfangen({
		type: "state",
		modi: MODI,
		aktuellerModus: "syntax-fix",
		befehle: [{ name: "help", description: "Hilfe" }],
		modell: "test-modell",
		modelle: ["test-modell", "anderes"],
		thinking: "low",
		thinkingStufen: ["off", "low", "high"],
		kontext: { tokens: 10, fenster: 100, prozent: 10 },
	});

	empfangen({ type: "pickFile" }); // Störer: darf nichts kaputt machen

	dom.window.document.getElementById("modusKnopf").click();
	const menue = dom.window.document.getElementById("menue");
	assert.equal(menue.hidden, false);
	assert.match(menue.textContent, /Syntax Fix/);
	assert.match(menue.textContent, /Cleanup/);

	dom.window.document.getElementById("modellKnopf").click();
	assert.match(menue.textContent, /test-modell/);
	assert.match(menue.textContent, /anderes/);

	dom.window.document.getElementById("thinkingKnopf").click();
	assert.match(menue.textContent, /low/);
	assert.equal(dom.window.document.getElementById("kontext").textContent, "10%");
});

test("Senden zeigt die Nachricht sofort und schickt sie an den Host", (t) => {
	const { dom, gesendet } = webviewStarten(t);
	const eingabe = dom.window.document.getElementById("eingabe");
	eingabe.value = "  Korrigiere das bitte  ";
	dom.window.document.getElementById("senden").click();

	assert.equal(JSON.stringify(gesendet.at(-1)), JSON.stringify({ type: "prompt", text: "Korrigiere das bitte" }));
	const verlauf = dom.window.document.getElementById("verlauf");
	assert.match(verlauf.textContent, /Du/);
	assert.match(verlauf.textContent, /Korrigiere das bitte/);
});

test("Antwort-Chunks landen im Verlauf und werden bei turnEnd abgeschlossen", (t) => {
	const { dom, empfangen } = webviewStarten(t);
	empfangen({ type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hallo **Welt**" } } });
	const verlauf = dom.window.document.getElementById("verlauf");
	assert.match(verlauf.textContent, /Hallo Welt/);
	assert.ok(verlauf.querySelector("strong"));
});

test("Arbeits-Anzeige erscheint während eines Zugs und verschwindet bei turnEnd", (t) => {
	const { dom, empfangen } = webviewStarten(t);
	const verlauf = dom.window.document.getElementById("verlauf");
	empfangen({ type: "userText", text: "Hallo" });
	assert.ok(verlauf.querySelector(".arbeitenZeile"), "Anzeige fehlt während des Zugs");
	assert.match(verlauf.textContent, /Syntax Bot arbeitet/);
	empfangen({ type: "turnEnd" });
	assert.equal(verlauf.querySelector(".arbeitenZeile"), null, "Anzeige bleibt nach turnEnd stehen");
});

test("Denk-Block ist während des Denkens offen und klappt bei der Antwort ein", (t) => {
	const { dom, empfangen } = webviewStarten(t);
	empfangen({ type: "update", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Ich überlege …" } } });
	const verlauf = dom.window.document.getElementById("verlauf");
	const block = verlauf.querySelector(".nachricht.denken");
	assert.ok(block);
	assert.match(block.textContent, /💡/, "💡-Icon fehlt");
	assert.ok(!block.classList.contains("eingeklappt"), "während des Denkens muss der Block offen sein");

	// Antwort beginnt → einklappen.
	empfangen({ type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fertig." } } });
	assert.ok(block.classList.contains("eingeklappt"), "nach Antwortbeginn muss der Block eingeklappt sein");

	// Manuelles Aufklappen per Kopfzeile.
	block.querySelector(".denkenKopf").click();
	assert.ok(!block.classList.contains("eingeklappt"), "Kopfzeile muss den Block wieder aufklappen");
});

test("Code-Blöcke bekommen einen Kopier-Knopf, der den Code in die Zwischenablage legt", async (t) => {
	const { dom, empfangen } = webviewStarten(t);
	let kopiert = null;
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: { writeText: async (text: string) => { kopiert = text; } },
	});
	empfangen({
		type: "update",
		update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Führe aus:\n```bash\nnpm test\n```" } },
	});
	const verlauf = dom.window.document.getElementById("verlauf");
	const knopf = verlauf.querySelector(".codeBlock .copyKnopf");
	assert.ok(knopf, "Kopier-Knopf fehlt");
	assert.match(verlauf.querySelector(".codeSprache").textContent, /bash/);
	knopf.click();
	await new Promise((fertig) => setTimeout(fertig, 10));
	assert.equal(kopiert, "npm test");
	assert.equal(knopf.textContent, "Kopiert ✓");
});

test("Nutzer- und Bot-Nachrichten sind klar getrennte Blöcke", (t) => {
	const { dom, empfangen } = webviewStarten(t);
	const eingabe = dom.window.document.getElementById("eingabe");
	eingabe.value = "Frage";
	dom.window.document.getElementById("senden").click();
	empfangen({ type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Antwort" } } });
	const verlauf = dom.window.document.getElementById("verlauf");
	assert.ok(verlauf.querySelector(".nachricht.nutzer"), "Nutzer-Nachricht fehlt");
	assert.ok(verlauf.querySelector(".nachricht.bot"), "Bot-Antwort fehlt");
	assert.notEqual(
		verlauf.querySelector(".nachricht.nutzer"),
		verlauf.querySelector(".nachricht.bot"),
	);
});

test("„/“ öffnet das Command-Popup und Enter vervollständigt", (t) => {
	const { dom, gesendet, empfangen } = webviewStarten(t);
	empfangen({
		type: "state",
		modi: MODI,
		aktuellerModus: "default",
		befehle: KOMMANDOS,
	});
	const eingabe = dom.window.document.getElementById("eingabe");
	eingabe.value = "/he";
	eingabe.dispatchEvent(new dom.window.Event("input"));

	const popup = dom.window.document.querySelector(".slashPopup");
	assert.equal(popup.hidden, false);
	assert.match(popup.textContent, /\/help/);

	eingabe.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	assert.equal(eingabe.value, "/help ");
	assert.equal(popup.hidden, true);
	assert.equal(gesendet.filter((n) => n.type === "prompt").length, 0);
});

const KOMMANDOS = [
	{ name: "help", description: "Hilfe" },
	{ name: "settings", description: "Einstellungen" },
];

test("Kopzeile: ⋯ zeigt Einstellungen, ＋ sendet /new", (t) => {
	const { dom, gesendet } = webviewStarten(t);
	dom.window.document.getElementById("punkte").click();
	const menue = dom.window.document.getElementById("menue");
	assert.match(menue.textContent, /Einstellungen/);

	dom.window.document.getElementById("neu").click();
	assert.equal(JSON.stringify(gesendet.at(-1)), JSON.stringify({ type: "prompt", text: "/new" }));
});

test("Berechtigungsdialog: Übernehmen meldet die Auswahl", (t) => {
	const { dom, gesendet, empfangen } = webviewStarten(t);
	empfangen({
		type: "permission",
		frage: "Änderung übernehmen?",
		optionen: [
			{ id: "ja", text: "Übernehmen" },
			{ id: "nein", text: "Verwerfen" },
		],
	});
	const karte = dom.window.document.querySelector(".berechtigung");
	assert.ok(karte);
	const knoepfe = karte.querySelectorAll("button");
	assert.equal(knoepfe.length, 2);
	knoepfe[0].click();
	assert.equal(JSON.stringify(gesendet.at(-1)), JSON.stringify({ type: "permission", optionId: "ja" }));
	assert.equal(dom.window.document.querySelectorAll(".berechtigung").length, 0);
});
