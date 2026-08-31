/**
 * Syntax Bot — Browser-Logik.
 *
 * Spricht per WebSocket mit web/server. Zwei Regeln stehen über allem:
 *  1. XSS-Sicherheit: Inhalte von Agent und Nutzer kommen ausschließlich über
 *     textContent ins DOM, niemals über innerHTML.
 *  2. LRS-freundliche Klarheit: jede Rückfrage ist ein großer, ruhiger Dialog
 *     mit genau einer Frage und eindeutig beschrifteten Knöpfen.
 */

"use strict";

const verlauf = document.getElementById("verlauf");
const eingabeformular = document.getElementById("eingabeformular");
const eingabe = document.getElementById("eingabe");
const arbeitsanzeige = document.getElementById("arbeitsanzeige");
const abbrechenKnopf = document.getElementById("abbrechen-knopf");
const verbindung = document.getElementById("verbindung");
const modusAnzeige = document.getElementById("modus-anzeige");
const modusPunkte = document.getElementById("modus-punkte");
const modusName = document.getElementById("modus-name");
const modellName = document.getElementById("modell-name");
const dialogOverlay = document.getElementById("dialog-overlay");
const dialogTitel = document.getElementById("dialog-titel");
const dialogInhalt = document.getElementById("dialog-inhalt");
const dialogKnoepfe = document.getElementById("dialog-knoepfe");

const modellKnopf = document.getElementById("modell-knopf");
const nutzerName = document.getElementById("nutzer-name");
const einstellungenOverlay = document.getElementById("einstellungen-overlay");
const byomEndpunkt = document.getElementById("byom-endpunkt");
const byomSchluessel = document.getElementById("byom-schluessel");
const byomModell = document.getElementById("byom-modell");
const byomModellliste = document.getElementById("byom-modellliste");

let socket = null;
let aktiveAgentNachricht = null;
let dialogOffen = false;
let einstellungenOffen = false;

/* --- Hilfsfunktionen --------------------------------------------------- */

function elementErstellen(tag, klasse, text) {
	const el = document.createElement(tag);
	if (klasse) el.className = klasse;
	if (text !== undefined) el.textContent = text;
	return el;
}

function nachScrollen() {
	verlauf.scrollTop = verlauf.scrollHeight;
}

/**
 * Mini-Markdown, bewusst klein gehalten: Code-Zäune (```), Inline-Code (`)
 * und Absätze. Alles andere bleibt Klartext — für die Zielgruppe ist
 * verlässlich lesbarer Text wichtiger als Formatvielfalt.
 */
function rendereText(container, text) {
	const abschnitte = text.split(/```/);
	abschnitte.forEach((abschnitt, index) => {
		if (index % 2 === 1) {
			// Code-Block: erste Zeile ist oft nur die Sprachangabe.
			const zeilen = abschnitt.replace(/^\n/, "").split("\n");
			const inhalt = zeilen.length > 1 && /^[\w-]*$/.test(zeilen[0]) ? zeilen.slice(1).join("\n") : zeilen.join("\n");
			const pre = elementErstellen("pre");
			const code = elementErstellen("code", "", inhalt.replace(/\n$/, ""));
			pre.appendChild(code);
			container.appendChild(pre);
			return;
		}

		for (const absatz of abschnitt.split(/\n{2,}/)) {
			const getrimmt = absatz.trim();
			if (!getrimmt) continue;
			const p = document.createElement("p");
			// Inline-Code in Backticks.
			for (const [teilIndex, teil] of getrimmt.split(/`([^`]+)`/).entries()) {
				if (teilIndex % 2 === 1) p.appendChild(elementErstellen("code", "", teil));
				else p.appendChild(document.createTextNode(teil));
			}
			container.appendChild(p);
		}
	});
}

function nachrichtHinzufuegen(klasse, text) {
	const el = elementErstellen("article", `nachricht ${klasse}`);
	rendereText(el, text);
	verlauf.appendChild(el);
	nachScrollen();
	return el;
}

/* --- Dialoge (Diff-Vorschau, Auswahl, Eingabe) -------------------------- */

function dialogSchliessen() {
	dialogOverlay.hidden = true;
	dialogOffen = false;
	dialogTitel.textContent = "";
	dialogInhalt.replaceChildren();
	dialogKnoepfe.replaceChildren();
	eingabe.focus();
}

function dialogOeffnen(titel) {
	dialogTitel.textContent = titel;
	dialogInhalt.replaceChildren();
	dialogKnoepfe.replaceChildren();
	dialogOverlay.hidden = false;
	dialogOffen = true;
}

function dialogKnopf(beschriftung, klasse, aktion) {
	const knopf = elementErstellen("button", `knopf ${klasse}`, beschriftung);
	knopf.type = "button";
	knopf.addEventListener("click", aktion);
	dialogKnoepfe.appendChild(knopf);
	return knopf;
}

/**
 * Diff nach der Spec: Punkt-Markierung links (● geändert, ○ unverändert),
 * Signalfarbe als Fläche plus linker Rand — Zeichen UND Farbe, nie Farbe
 * allein. Als Tabelle mit Rollen ausgezeichnet, damit Screenreader die
 * Vorschau strukturiert vorlesen können.
 */
function rendereDiff(container, zeilen) {
	const tabelle = elementErstellen("div", "diff");
	tabelle.setAttribute("role", "table");
	tabelle.setAttribute("aria-label", "Änderungsvorschau");

	for (const zeile of zeilen) {
		let klasse = "diff-zeile";
		let marke = "○";
		let bedeutung = "unverändert";
		if (zeile.startsWith("+++") || zeile.startsWith("---") || zeile.startsWith("@@")) {
			klasse += " diff-zeile--kopf";
			bedeutung = "Kopfzeile";
		} else if (zeile.startsWith("+")) {
			klasse += " diff-zeile--plus";
			marke = "●";
			bedeutung = "hinzugefügt";
		} else if (zeile.startsWith("-")) {
			klasse += " diff-zeile--minus";
			marke = "●";
			bedeutung = "entfernt";
		}

		const reihe = elementErstellen("div", klasse);
		reihe.setAttribute("role", "row");

		const markeZelle = elementErstellen("span", "diff-marke");
		markeZelle.setAttribute("role", "cell");
		const zeichen = elementErstellen("span", "", marke);
		zeichen.setAttribute("aria-hidden", "true");
		markeZelle.appendChild(zeichen);
		markeZelle.appendChild(elementErstellen("span", "visually-hidden", bedeutung));

		const inhaltZelle = elementErstellen("span", "diff-inhalt", zeile);
		inhaltZelle.setAttribute("role", "cell");

		reihe.appendChild(markeZelle);
		reihe.appendChild(inhaltZelle);
		tabelle.appendChild(reihe);
	}
	container.appendChild(tabelle);
}

function istDiffZeile(zeile) {
	return /^(@@|\+(?!\+)|-(?!-))/.test(zeile);
}

function zeigeBestaetigung(requestId, titel, text) {
	dialogOeffnen(titel);

	const zeilen = text.split("\n");
	// Die Abschlussfrage („Änderungen übernehmen?") abtrennen — sie steht
	// prominent unter dem Inhalt statt irgendwo im Diff.
	let frage = "";
	while (zeilen.length > 0 && zeilen[zeilen.length - 1].trim() === "") zeilen.pop();
	if (zeilen.length > 0 && zeilen[zeilen.length - 1].trim().endsWith("?")) {
		frage = zeilen.pop().trim();
		while (zeilen.length > 0 && zeilen[zeilen.length - 1].trim() === "") zeilen.pop();
	}

	if (zeilen.some(istDiffZeile)) {
		rendereDiff(dialogInhalt, zeilen);
	} else {
		rendereText(dialogInhalt, zeilen.join("\n"));
	}
	if (frage) dialogInhalt.appendChild(elementErstellen("p", "dialog-frage", frage));

	const uebernehmen = /übernehmen|anlegen/i.test(frage);
	const ja = uebernehmen ? "Übernehmen" : "Ja";
	const nein = uebernehmen ? "Verwerfen" : "Nein";

	const antworten = (wert) => {
		sendeNachricht({ type: "ui_response", requestId, value: wert });
		dialogSchliessen();
	};

	// Die primäre Aktion steht rechts (Spec) — deshalb zuerst die sekundäre.
	dialogKnopf(nein, "knopf--sekundaer", () => antworten(false));
	dialogKnopf(ja, "knopf--primaer", () => antworten(true)).focus();
	dialogOverlay.dataset.abbruchWert = "false";
}

function zeigeAuswahl(requestId, titel, optionen) {
	dialogOeffnen(titel);
	const liste = elementErstellen("div", "auswahl-liste");

	const antworten = (wert) => {
		sendeNachricht({ type: "ui_response", requestId, value: wert });
		dialogSchliessen();
	};

	for (const option of optionen) {
		const knopf = elementErstellen("button", "knopf knopf--sekundaer", option);
		knopf.type = "button";
		knopf.addEventListener("click", () => antworten(option));
		liste.appendChild(knopf);
	}
	dialogInhalt.appendChild(liste);
	liste.querySelector("button")?.focus();

	dialogKnopf("Abbrechen", "knopf--sekundaer", () => antworten(null));
	dialogOverlay.dataset.abbruchWert = "";
}

function zeigeEingabe(requestId, titel, platzhalter) {
	dialogOeffnen(titel);

	const feld = document.createElement("input");
	feld.type = "text";
	feld.className = "dialog-eingabefeld";
	if (platzhalter) feld.placeholder = platzhalter;
	dialogInhalt.appendChild(feld);

	const antworten = (wert) => {
		sendeNachricht({ type: "ui_response", requestId, value: wert });
		dialogSchliessen();
	};

	const formular = elementErstellen("form");
	formular.addEventListener("submit", (ereignis) => {
		ereignis.preventDefault();
		antworten(feld.value);
	});
	feld.replaceWith(formular);
	formular.appendChild(feld);

	dialogKnopf("Abbrechen", "knopf--sekundaer", () => antworten(null));
	dialogKnopf("Bestätigen", "knopf--primaer", () => antworten(feld.value));
	dialogOverlay.dataset.abbruchWert = "";
	feld.focus();
}

/* Escape bricht einen Dialog ab — das entspricht „Nein"/Abbrechen.
   Der Einstellungsdialog schließt ohne Antwort an den Agent. */
document.addEventListener("keydown", (ereignis) => {
	if (ereignis.key !== "Escape") return;
	if (einstellungenOffen) {
		einstellungenSchliessen();
		return;
	}
	if (!dialogOffen) return;
	const wert = dialogOverlay.dataset.abbruchWert;
	const letzteAnfrage = dialogOverlay.dataset.requestId;
	if (letzteAnfrage === undefined) return;
	sendeNachricht({
		type: "ui_response",
		requestId: Number(letzteAnfrage),
		value: wert === "false" ? false : null,
	});
	dialogSchliessen();
});

/* --- LRS-Schrift (OpenDyslexic) ---------------------------------------- */

const schriftKnopf = document.getElementById("schrift-knopf");
const SCHRIFT_SPEICHER = "syntax-bot-schrift-lrs";

function schriftAnwenden(an) {
	document.body.classList.toggle("schrift-lrs", an);
	schriftKnopf.setAttribute("aria-pressed", String(an));
	try {
		localStorage.setItem(SCHRIFT_SPEICHER, an ? "1" : "0");
	} catch {
		// Ohne Speicherzugriff wirkt die Wahl nur bis zum Neuladen.
	}
}

schriftKnopf.addEventListener("click", () => {
	schriftAnwenden(!document.body.classList.contains("schrift-lrs"));
});

try {
	if (localStorage.getItem(SCHRIFT_SPEICHER) === "1") schriftAnwenden(true);
} catch {
	// localStorage kann z. B. in restriktiven Kontexten fehlen.
}

/* --- Eigenes Modell verbinden (BYOM) ---------------------------------- */

function einstellungenOeffnen() {
	einstellungenOverlay.hidden = false;
	einstellungenOffen = true;
	byomEndpunkt.focus();
}

function einstellungenSchliessen() {
	einstellungenOverlay.hidden = true;
	einstellungenOffen = false;
	eingabe.focus();
}

modellKnopf.addEventListener("click", einstellungenOeffnen);
document.getElementById("byom-schliessen").addEventListener("click", einstellungenSchliessen);

document.getElementById("byom-testen").addEventListener("click", () => {
	sendeNachricht({ type: "byom_test", baseUrl: byomEndpunkt.value.trim(), apiKey: byomSchluessel.value.trim() });
});

document.getElementById("byom-speichern").addEventListener("click", () => {
	sendeNachricht({
		type: "byom_save",
		config: {
			baseUrl: byomEndpunkt.value.trim(),
			apiKey: byomSchluessel.value.trim(),
			modelId: byomModell.value.trim(),
		},
	});
});

/* Ein Eintrag aus der abgerufenen Modell-Liste übernimmt die Modell-ID. */
byomModellliste.addEventListener("change", () => {
	if (byomModellliste.value) byomModell.value = byomModellliste.value;
});

function zeigeByomModelle(modelle) {
	byomModellliste.replaceChildren();
	for (const id of modelle) {
		const option = document.createElement("option");
		option.value = id;
		option.textContent = id;
		byomModellliste.appendChild(option);
	}
	byomModellliste.hidden = modelle.length === 0;
}

/* --- Modus-Dot-Leiste (Spec „Modus-Visualisierung") ------------------- */

/** Punkt-Muster der drei Modi: Syntax Fix ●○○, Code Fix ●●○, Cleanup ◐◐◐. */
const MODUS_PUNKTE = {
	"Syntax Fix": ["●", "○", "○"],
	"Code Fix": ["●", "●", "○"],
	"Cleanup": ["◐", "◐", "◐"],
};

function zeigeModus(text) {
	if (!text) {
		modusAnzeige.hidden = true;
		return;
	}
	const name = text.replace(/^●\s*/, "");
	modusName.textContent = name;
	modusPunkte.replaceChildren(
		...(MODUS_PUNKTE[name] ?? ["●", "○", "○"]).map((zeichen) =>
			elementErstellen("span", zeichen === "○" ? "punkt punkt--leer" : "punkt", zeichen),
		),
	);
	modusAnzeige.hidden = false;
}

/* --- Server-Nachrichten -------------------------------------------------- */

function verarbeiteNachricht(nachricht) {
	switch (nachricht.type) {
		case "ready":
			modellName.textContent = nachricht.model ? String(nachricht.model) : "kein Modell";
			if (nachricht.user) {
				nutzerName.textContent = String(nachricht.user);
				nutzerName.hidden = false;
			}
			break;

		case "byom_models":
			zeigeByomModelle(Array.isArray(nachricht.models) ? nachricht.models : []);
			break;

		case "model_changed":
			modellName.textContent = nachricht.model ? String(nachricht.model) : "kein Modell";
			einstellungenSchliessen();
			break;

		case "notify": {
			const klasse = nachricht.level === "error" ? "nachricht--fehler" : "nachricht--hinweis";
			nachrichtHinzufuegen(klasse, nachricht.message);
			break;
		}

		case "status":
			if (nachricht.key === "syntax-bot-mode") zeigeModus(nachricht.text);
			break;

		case "working":
			arbeitsanzeige.hidden = !nachricht.on;
			if (nachricht.on !== true) aktiveAgentNachricht = null;
			break;

		case "assistant_start":
			aktiveAgentNachricht = elementErstellen("article", "nachricht nachricht--agent");
			verlauf.appendChild(aktiveAgentNachricht);
			nachScrollen();
			break;

		case "assistant_update":
		case "assistant_end": {
			if (!aktiveAgentNachricht) {
				aktiveAgentNachricht = elementErstellen("article", "nachricht nachricht--agent");
				verlauf.appendChild(aktiveAgentNachricht);
			}
			aktiveAgentNachricht.replaceChildren();
			rendereText(aktiveAgentNachricht, nachricht.text ?? "");
			nachScrollen();
			if (nachricht.type === "assistant_end") aktiveAgentNachricht = null;
			break;
		}

		case "tool":
			if (nachricht.phase === "start") {
				nachrichtHinzufuegen("nachricht--werkzeug", `Werkzeug: ${nachricht.toolName} …`);
			}
			break;

		case "ui_request":
			dialogOverlay.dataset.requestId = String(nachricht.requestId);
			if (nachricht.kind === "confirm") zeigeBestaetigung(nachricht.requestId, nachricht.title, nachricht.body);
			else if (nachricht.kind === "select") zeigeAuswahl(nachricht.requestId, nachricht.title, nachricht.options);
			else if (nachricht.kind === "input") zeigeEingabe(nachricht.requestId, nachricht.title, nachricht.placeholder);
			break;
	}
}

/* --- Verbindung ------------------------------------------------------------ */

function sendeNachricht(nachricht) {
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(nachricht));
	}
}

function verbindungsstatusAnzeigen(verbunden) {
	verbindung.textContent = verbunden ? "verbunden" : "getrennt";
	verbindung.className = `verbindung ${verbunden ? "verbindung--verbunden" : "verbindung--getrennt"}`;
}

function verbinden() {
	const ziel = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
	socket = new WebSocket(ziel);

	socket.addEventListener("open", () => verbindungsstatusAnzeigen(true));
	socket.addEventListener("message", (ereignis) => {
		try {
			verarbeiteNachricht(JSON.parse(ereignis.data));
		} catch {
			// Eine kaputte Nachricht darf die Oberfläche nicht abreißen lassen.
		}
	});
	socket.addEventListener("close", () => {
		verbindungsstatusAnzeigen(false);
		arbeitsanzeige.hidden = true;
		if (dialogOffen) dialogSchliessen();
		// Neu verbinden heißt: neue Sitzung auf dem Server.
		setTimeout(verbinden, 3000);
	});
}

/* --- Eingabe ------------------------------------------------------------ */

eingabeformular.addEventListener("submit", (ereignis) => {
	ereignis.preventDefault();
	const text = eingabe.value.trim();
	if (!text) return;

	nachrichtHinzufuegen("nachricht--nutzer", text);
	sendeNachricht({ type: "user_message", text });
	eingabe.value = "";
	eingabe.focus();
});

eingabe.addEventListener("keydown", (ereignis) => {
	if (ereignis.key === "Enter" && !ereignis.shiftKey) {
		ereignis.preventDefault();
		eingabeformular.requestSubmit();
	}
});

abbrechenKnopf.addEventListener("click", () => {
	sendeNachricht({ type: "interrupt" });
});

verbinden();
