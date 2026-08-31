/**
 * Syntax Bot — Browser-Logik.
 *
 * Spricht per WebSocket mit web/server. Zwei Regeln stehen über allem:
 *  1. XSS-Sicherheit: Inhalte von Agent und Nutzer kommen ausschließlich über
 *     textContent ins DOM, niemals über innerHTML.
 *  2. LRS-freundliche Klarheit: jede Rückfrage ist ein großer, ruhiger Dialog
 *     mit genau einer Frage und eindeutig beschrifteten Knöpfen.
 *
 * Die Chat-Darstellung folgt der VS-Code-Version: Rollen-Labels, einklappbare
 * Denk-Blöcke, Code-Blöcke mit Kopfzeile und Kopier-Knopf, Aktionsleiste mit
 * Anhang/Kontext/Modell/Thinking/Modus unter der Eingabe sowie Kopfzeile mit
 * „+“ (neuer Thread) und „⋯“ (Menü).
 */

"use strict";

const verlauf = document.getElementById("verlauf");
const eingabeformular = document.getElementById("eingabeformular");
const eingabe = document.getElementById("eingabe");
const arbeitsanzeige = document.getElementById("arbeitsanzeige");
const abbrechenKnopf = document.getElementById("abbrechen-knopf");
const verbindung = document.getElementById("verbindung");
const nutzerName = document.getElementById("nutzer-name");
const dialogOverlay = document.getElementById("dialog-overlay");
const dialogTitel = document.getElementById("dialog-titel");
const dialogInhalt = document.getElementById("dialog-inhalt");
const dialogKnoepfe = document.getElementById("dialog-knoepfe");

const kontextAnzeige = document.getElementById("kontext-anzeige");
const modellKnopf = document.getElementById("modell-knopf");
const thinkingKnopf = document.getElementById("thinking-knopf");
const modusKnopf = document.getElementById("modus-knopf");
const neuKnopf = document.getElementById("neu-knopf");
const menueKnopf = document.getElementById("menue-knopf");
const anhangKnopf = document.getElementById("anhang-knopf");
const anhangEingabe = document.getElementById("anhang-eingabe");

let socket = null;
let aktiveAgentNachricht = null;
let denkBlock = null;
let denkInhalt = null;
let dialogOffen = false;
let onboardingOffen = false;

/** Fußleisten-Zustand, gespeist aus session_state-/status-Nachrichten. */
let status = {
	modell: null,
	thinkingLevel: null,
	thinkingStufen: [],
	kontext: null,
};
let aktuellerModus = null; // Anzeigename des aktiven Modus, z. B. „Syntax Fix“
let gespeicherteProvider = [];

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
 * und Absätze. Code-Blöcke bekommen eine Kopfzeile mit Sprache und
 * Kopier-Knopf (wie in der VS-Code-Version).
 */
function rendereText(container, text) {
	const abschnitte = text.split(/```/);
	abschnitte.forEach((abschnitt, index) => {
		if (index % 2 === 1) {
			// Code-Block: erste Zeile ist oft nur die Sprachangabe.
			const zeilen = abschnitt.replace(/^\n/, "").split("\n");
			let sprache = "code";
			let inhalt = zeilen.join("\n");
			if (zeilen.length > 1 && /^[\w-]*$/.test(zeilen[0]) && zeilen[0]) {
				sprache = zeilen[0];
				inhalt = zeilen.slice(1).join("\n");
			}

			const block = elementErstellen("div", "code-block");
			const kopf = elementErstellen("div", "code-kopf");
			kopf.appendChild(elementErstellen("span", "code-sprache", sprache));
			kopf.appendChild(elementErstellen("button", "knopf knopf--klein code-kopie", "Kopieren"));
			block.appendChild(kopf);

			const pre = elementErstellen("pre");
			const code = elementErstellen("code", "", inhalt.replace(/\n$/, ""));
			pre.appendChild(code);
			block.appendChild(pre);
			container.appendChild(block);
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

/* Kopier-Knöpfe per Delegation — der Markdown-Renderer baut die Blöcke bei
   Streaming-Updates neu auf, Listener würden sonst verloren gehen. */
document.addEventListener("click", async (ereignis) => {
	const knopf = ereignis.target.closest?.(".code-kopie");
	if (!knopf) return;
	const codeText = knopf.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
	let ok = false;
	try {
		await navigator.clipboard.writeText(codeText);
		ok = true;
	} catch {
		try {
			const feld = document.createElement("textarea");
			feld.value = codeText;
			feld.style.cssText = "position:fixed;opacity:0";
			document.body.appendChild(feld);
			feld.select();
			ok = document.execCommand("copy");
			feld.remove();
		} catch {
			ok = false;
		}
	}
	knopf.textContent = ok ? "Kopiert ✓" : "Fehler";
	setTimeout(() => { knopf.textContent = "Kopieren"; }, 1500);
});

/** Nachricht mit Rollen-Label („Du“ / „Syntax Bot“) wie in der VS-Code-Version. */
function nachrichtHinzufuegen(klasse, text, rolle) {
	const el = elementErstellen("article", `nachricht ${klasse}`);
	if (rolle) el.appendChild(elementErstellen("div", "nachricht-rolle", rolle));
	rendereText(el, text);
	verlauf.appendChild(el);
	nachScrollen();
	return el;
}

/* --- Denk-Blöcke (einklappbar, wie in der VS-Code-Version) -------------- */

function denkBlockErzeugen() {
	const el = elementErstellen("article", "nachricht nachricht--denken");
	const kopf = document.createElement("button");
	kopf.type = "button";
	kopf.className = "denken-kopf";
	const etikett = elementErstellen("span", "", "💡 Denkprozess");
	const statusAnzeige = elementErstellen("span", "denken-status", "denkt …");
	const pfeil = elementErstellen("span", "denken-pfeil", "▾");
	pfeil.setAttribute("aria-hidden", "true");
	kopf.append(etikett, statusAnzeige, pfeil);
	kopf.addEventListener("click", () => el.classList.toggle("denken-eingeklappt"));
	const inhalt = elementErstellen("div", "denken-inhalt");
	el.append(kopf, inhalt);
	verlauf.appendChild(el);
	nachScrollen();
	return { el, inhalt };
}

function denkTextSetzen(text) {
	if (!denkBlock) {
		const erzeugt = denkBlockErzeugen();
		denkBlock = erzeugt.el;
		denkInhalt = erzeugt.inhalt;
	}
	denkBlock.classList.remove("denken-eingeklappt", "denken-fertig");
	denkInhalt.textContent = text;
	nachScrollen();
}

function denkEinklappen() {
	if (denkBlock) denkBlock.classList.add("denken-eingeklappt", "denken-fertig");
	denkBlock = null;
	denkInhalt = null;
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
   Onboarding und Menüs schließen ohne Antwort. */
document.addEventListener("keydown", (ereignis) => {
	if (ereignis.key !== "Escape") return;
	if (onboardingOffen) {
		onboardingSchliessen();
		return;
	}
	if (!menue.hidden) {
		menueVerbergen();
		return;
	}
	if (slashPopupOffen()) {
		slashPopupVerbergen();
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

/* --- Aufklapp-Menüs (wie die Fußleisten-Menüs der VS-Code-Version) ------- */

const menue = elementErstellen("div", "menue");
menue.hidden = true;
document.body.appendChild(menue);

function menueZeigen(anker, eintraege) {
	menue.replaceChildren();
	for (const eintrag of eintraege) {
		const knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = `menue-eintrag${eintrag.aktiv ? " menue-eintrag--aktiv" : ""}`;
		knopf.appendChild(elementErstellen("span", "", eintrag.text));
		if (eintrag.beschreibung) {
			knopf.appendChild(elementErstellen("span", "menue-beschreibung", eintrag.beschreibung));
		}
		knopf.addEventListener("click", () => {
			menueVerbergen();
			eintrag.aktion();
		});
		menue.appendChild(knopf);
	}
	if (eintraege.length === 0) {
		menue.appendChild(elementErstellen("div", "menue-leer", "Nichts vorhanden"));
	}
	menue.hidden = false;
	const feld = anker.getBoundingClientRect();
	menue.style.left = "";
	menue.style.right = `${Math.max(window.innerWidth - feld.right, 8)}px`;
	menue.style.top = "";
	menue.style.bottom = "";
	// Anker in der oberen Bildschirmhälfte → Menü DARUNTER, sonst darüber.
	if (feld.top < window.innerHeight / 2) {
		menue.style.top = `${feld.bottom + 4}px`;
	} else {
		menue.style.bottom = `${window.innerHeight - feld.top + 4}px`;
	}
}

function menueVerbergen() {
	menue.hidden = true;
}

document.addEventListener("click", (ereignis) => {
	const ziel = ereignis.target.closest?.(".fuss-knopf, .kopf-aktion");
	if (!menue.hidden && !menue.contains(ereignis.target) && !ziel) {
		menueVerbergen();
	}
});

/* --- Fußleisten-Anzeigen -------------------------------------------------- */

/** Punkt-Muster der drei Modi: Syntax Fix ●○○, Code Fix ●●○, Cleanup ◐◐◐. */
const MODUS_PUNKTE = {
	"Syntax Fix": "●○○",
	"Code Fix": "●●○",
	"Cleanup": "◐◐◐",
};

function fussLeisteRendern() {
	// Kontext-Füllstand als Prozentanzeige.
	if (status.kontext?.prozent != null) {
		kontextAnzeige.textContent = `${status.kontext.prozent}%`;
		kontextAnzeige.title =
			status.kontext.tokens != null
				? `Kontext: ${status.kontext.tokens} von ${status.kontext.fenster ?? "?"} Tokens`
				: "Kontext-Füllstand";
	} else {
		kontextAnzeige.textContent = "—";
		kontextAnzeige.title = "Noch keine Kontextdaten";
	}

	modellKnopf.textContent = "";
	const modellEtikett = elementErstellen("span", "etikett", status.modell ?? "Modell");
	modellKnopf.appendChild(modellEtikett);

	thinkingKnopf.textContent = "";
	const thinkEtikett = elementErstellen(
		"span",
		"etikett",
		status.thinkingLevel ? `Think:${status.thinkingLevel}` : "Think",
	);
	thinkingKnopf.appendChild(thinkEtikett);

	modusKnopf.textContent = "";
	const modusPunkte = elementErstellen(
		"span",
		"",
		aktuellerModus ? MODUS_PUNKTE[aktuellerModus] ?? "●○○" : "○○○",
	);
	const modusEtikett = elementErstellen("span", "etikett", aktuellerModus ?? "Modus");
	modusKnopf.append(modusPunkte, modusEtikett);
	modusKnopf.classList.toggle("fuss-knopf--aktiv", aktuellerModus !== null);
}

function zeigeModus(text) {
	// Der Extension-Status kommt als „● Syntax Fix“ — das Präfix abtrennen.
	aktuellerModus = text ? text.replace(/^●\s*/, "") : null;
	fussLeisteRendern();
}

/* --- Fußleisten-Menüs: Modell, Thinking, Modus -------------------------- */

modellKnopf.addEventListener("click", () => {
	const eintraege = gespeicherteProvider.map((provider) => ({
		text: `${provider.displayName} · ${provider.modelId}`,
		aktiv: status.modell === provider.modelId,
		aktion: () => sendeNachricht({ type: "byom_activate", providerId: provider.providerId }),
	}));
	eintraege.push({
		text: "Modell konfigurieren …",
		beschreibung: "Konto",
		aktion: () => { location.href = "/konto"; },
	});
	menueZeigen(modellKnopf, eintraege);
});

thinkingKnopf.addEventListener("click", () => {
	if (status.thinkingStufen.length === 0) {
		menueZeigen(thinkingKnopf, [{
			text: "Das aktuelle Modell unterstützt kein Thinking.",
			aktion: () => {},
		}]);
		return;
	}
	menueZeigen(thinkingKnopf, status.thinkingStufen.map((stufe) => ({
		text: stufe,
		aktiv: stufe === status.thinkingLevel,
		aktion: () => sendeNachricht({ type: "set_thinking", level: stufe }),
	})));
});

/** Modus-Auswahl: keine Modi im SDK — die Extensions hängen an Slash-Commands. */
const MODUS_AUSWAHL = [
	{ label: null, text: "Kein Modus", beschreibung: "volle Werkzeuge", command: "/modus-aus" },
	{ label: "Syntax Fix", text: "●○○ Syntax Fix", beschreibung: "nur Rechtschreibung/Syntax", command: "/syntax-fix" },
	{ label: "Code Fix", text: "●●○ Code Fix", beschreibung: "Syntax, Struktur, Fehler", command: "/code-fix" },
	{ label: "Cleanup", text: "◐◐◐ Cleanup", beschreibung: "nur Formatierung", command: "/cleanup" },
];

modusKnopf.addEventListener("click", () => {
	menueZeigen(modusKnopf, MODUS_AUSWAHL.map((modus) => ({
		text: modus.text,
		beschreibung: modus.beschreibung,
		aktiv: modus.label === aktuellerModus,
		aktion: () => {
			// Reine Steuerkommandos ohne eigene Chat-Nachricht senden.
			sendeNachricht({ type: "user_message", text: modus.command });
		},
	})));
});

/* --- Kopfzeile: neuer Thread und ⋯-Menü ---------------------------------- */

function willkommenErstellen() {
	const section = elementErstellen("section", "willkommen");
	const p = elementErstellen("p",
		"Willkommen bei Syntax Bot. Wähle einen Modus und verweise auf den Code — " +
		"jede Änderung wird dir vorher als Vorschau gezeigt.");
	section.appendChild(p);
	const liste = elementErstellen("ul", "modus-liste");
	for (const [befehl, beschreibung] of [
		["/syntax-fix", "nur Rechtschreibung und Syntax"],
		["/code-fix", "Syntax, Struktur und Fehler"],
		["/cleanup", "nur Struktur und Formatierung"],
	]) {
		const li = document.createElement("li");
		li.appendChild(elementErstellen("code", "", befehl));
		li.appendChild(document.createTextNode(` — ${beschreibung}`));
		liste.appendChild(li);
	}
	section.appendChild(liste);
	return section;
}

function neuerThread() {
	sendeNachricht({ type: "new_thread" });
	verlauf.replaceChildren(willkommenErstellen());
	aktiveAgentNachricht = null;
	denkBlock = null;
	denkInhalt = null;
	arbeitsanzeige.hidden = true;
	status = { modell: status.modell, thinkingLevel: status.thinkingLevel, thinkingStufen: status.thinkingStufen, kontext: null };
	aktuellerModus = null;
	fussLeisteRendern();
}

neuKnopf.addEventListener("click", neuerThread);

/** Thread als Markdown exportieren — aus dem sichtbaren Verlauf aufgebaut. */
function exportiereThread() {
	const zeilen = [];
	for (const element of verlauf.children) {
		if (element.classList.contains("willkommen")) continue;
		const text = (element.querySelector(".denken-inhalt") ?? element).textContent.trim();
		if (!text) continue;
		if (element.classList.contains("nachricht--nutzer")) zeilen.push("## Du\n", text, "");
		else if (element.classList.contains("nachricht--denken")) zeilen.push("> 💡 Denkprozess", ...text.split("\n").map((z) => `> ${z}`), "");
		else if (element.classList.contains("nachricht--agent")) zeilen.push("## Syntax Bot\n", text, "");
		else zeilen.push(`*${text}*`, "");
	}
	const datum = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
	const blob = new Blob([zeilen.join("\n")], { type: "text/markdown;charset=utf-8" });
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = `syntax-bot-thread-${datum}.md`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(link.href);
}

menueKnopf.addEventListener("click", () => {
	menueZeigen(menueKnopf, [
		{ text: "Neuer Thread", beschreibung: "+", aktion: neuerThread },
		{ text: "Thread als Markdown exportieren", beschreibung: ".md", aktion: exportiereThread },
		{ text: "Hilfe", beschreibung: "Onboarding", aktion: onboardingOeffnen },
		{ text: "Anmelden", beschreibung: "Startseite", aktion: () => { location.href = "/"; } },
	]);
});

/* --- Datei-Anhang ---------------------------------------------------------- */

anhangKnopf.addEventListener("click", () => anhangEingabe.click());

function base64VonPuffer(puffer) {
	const bytes = new Uint8Array(puffer);
	let binar = "";
	const stueckGroesse = 0x8000;
	for (let position = 0; position < bytes.length; position += stueckGroesse) {
		binar += String.fromCharCode(...bytes.subarray(position, position + stueckGroesse));
	}
	return btoa(binar);
}

anhangEingabe.addEventListener("change", async () => {
	for (const datei of anhangEingabe.files ?? []) {
		if (datei.size > 10 * 1024 * 1024) {
			nachrichtHinzufuegen("nachricht--fehler", `„${datei.name}“ ist größer als 10 MB und wurde nicht angehängt.`);
			continue;
		}
		try {
			const inhalt = base64VonPuffer(await datei.arrayBuffer());
			sendeNachricht({ type: "file_upload", name: datei.name, content: inhalt });
		} catch {
			nachrichtHinzufuegen("nachricht--fehler", `„${datei.name}“ konnte nicht gelesen werden.`);
		}
	}
	anhangEingabe.value = "";
});

/** Nach dem Upload: Pfad in die Eingabe einfügen, damit der Agent ihn sieht. */
function textInEingabeEinfuegen(text) {
	const start = eingabe.selectionStart ?? eingabe.value.length;
	const praefix = eingabe.value.slice(0, start);
	const einfuegen = praefix && !praefix.endsWith(" ") && !praefix.endsWith("\n") ? ` ${text}` : text;
	eingabe.value = praefix + einfuegen + eingabe.value.slice(start);
	eingabe.focus();
}

/* --- Onboarding (fünf Seiten) ------------------------------------------- */

const onboardingOverlay = document.getElementById("onboarding-overlay");
const onboardingSeiten = Array.from(document.querySelectorAll(".onboarding-seite"));
const onbZurueck = document.getElementById("onb-zurueck");
const onbWeiter = document.getElementById("onb-weiter");
const onbUeberspringen = document.getElementById("onb-ueberspringen");
const onbPunktleiste = document.getElementById("onb-punkte");
const onbModellliste = document.getElementById("onb-modellliste");
const onbModell = document.getElementById("onb-modell");
const ONBOARDING_SPEICHER = "syntax-bot-onboarding-erledigt";
let onboardingSeite = 0;

function onboardingRendern() {
	onboardingSeiten.forEach((seite, index) => {
		seite.hidden = index !== onboardingSeite;
	});
	onbZurueck.hidden = onboardingSeite === 0;
	onbWeiter.textContent = onboardingSeite === onboardingSeiten.length - 1 ? "Los geht's" : "Weiter";

	onbPunktleiste.replaceChildren();
	onboardingSeiten.forEach((_, index) => {
		onbPunktleiste.appendChild(elementErstellen("span", index === onboardingSeite ? "onb-punkt onb-punkt--aktiv" : "onb-punkt", "●"));
	});
}

function onboardingOeffnen() {
	onboardingSeite = 0;
	onboardingRendern();
	onboardingOverlay.hidden = false;
	onboardingOffen = true;
	onbWeiter.focus();
}

function onboardingSchliessen() {
	onboardingOverlay.hidden = true;
	onboardingOffen = false;
	try {
		localStorage.setItem(ONBOARDING_SPEICHER, "1");
	} catch {
		// Ohne Speicherzugriff erscheint das Onboarding beim nächsten Besuch erneut.
	}
	eingabe.focus();
}

/** Seite 5: ausgefülltes Formular wird beim Abschluss noch gespeichert. */
function onboardingAbschliessen() {
	const endpunkt = document.getElementById("onb-endpunkt").value.trim();
	const modellId = document.getElementById("onb-modell").value.trim();
	if (endpunkt && modellId) {
		sendeNachricht({
			type: "byom_save",
			config: {
				baseUrl: endpunkt,
				apiKey: document.getElementById("onb-schluessel").value.trim(),
				modelId,
			},
		});
	}
	onboardingSchliessen();
}

onbUeberspringen.addEventListener("click", onboardingAbschliessen);
onbZurueck.addEventListener("click", () => {
	if (onboardingSeite > 0) {
		onboardingSeite--;
		onboardingRendern();
	}
});
onbWeiter.addEventListener("click", () => {
	if (onboardingSeite < onboardingSeiten.length - 1) {
		onboardingSeite++;
		onboardingRendern();
	} else {
		onboardingAbschliessen();
	}
});

document.getElementById("onb-testen").addEventListener("click", () => {
	sendeNachricht({
		type: "byom_test",
		baseUrl: document.getElementById("onb-endpunkt").value.trim(),
		apiKey: document.getElementById("onb-schluessel").value.trim(),
	});
});

onbModellliste.addEventListener("change", () => {
	if (onbModellliste.value) onbModell.value = onbModellliste.value;
});

function zeigeByomModelle(modelle) {
	onbModellliste.replaceChildren();
	for (const id of modelle) {
		const option = document.createElement("option");
		option.value = id;
		option.textContent = id;
		onbModellliste.appendChild(option);
	}
	onbModellliste.hidden = modelle.length === 0;
}

try {
	if (localStorage.getItem(ONBOARDING_SPEICHER) !== "1") onboardingOeffnen();
} catch {
	// Ohne localStorage kein Erstbesuch-Marker — dann lieber einmal zu viel zeigen.
	onboardingOeffnen();
}

/* --- „/“-Popup für die drei Modi (wie in der VS-Code-Version) ----------- */

const slashPopup = elementErstellen("div", "menue slash-popup");
slashPopup.hidden = true;
document.body.appendChild(slashPopup);
let slashTreffer = [];

function slashPopupOffen() {
	return !slashPopup.hidden;
}

function slashPopupVerbergen() {
	slashPopup.hidden = true;
}

function slashPopupAktualisieren() {
	const text = eingabe.value;
	if (!text.startsWith("/") || text.includes(" ") || text.includes("\n")) {
		slashPopupVerbergen();
		return;
	}
	const fragment = text.slice(1).toLowerCase();
	slashTreffer = MODUS_AUSWAHL
		.filter((modus) => modus.label)
		.map((modus) => ({ name: modus.command.slice(1), beschreibung: modus.beschreibung }))
		.filter((befehl) => befehl.name.startsWith(fragment));
	if (slashTreffer.length === 0) {
		slashPopupVerbergen();
		return;
	}
	slashPopup.replaceChildren();
	for (const befehl of slashTreffer) {
		const zeile = elementErstellen("button", "menue-eintrag");
		zeile.type = "button";
		zeile.appendChild(elementErstellen("span", "", `/${befehl.name}`));
		zeile.appendChild(elementErstellen("span", "menue-beschreibung", befehl.beschreibung));
		zeile.addEventListener("click", () => {
			eingabe.value = `/${befehl.name} `;
			slashPopupVerbergen();
			eingabe.focus();
		});
		slashPopup.appendChild(zeile);
	}
	slashPopup.hidden = false;
	const feld = eingabeformular.getBoundingClientRect();
	slashPopup.style.left = `${Math.max(feld.left, 8)}px`;
	slashPopup.style.bottom = `${window.innerHeight - feld.top + 4}px`;
}

eingabe.addEventListener("input", slashPopupAktualisieren);

/* --- Server-Nachrichten -------------------------------------------------- */

function verarbeiteNachricht(nachricht) {
	switch (nachricht.type) {
		case "ready":
			status.modell = nachricht.model ? String(nachricht.model) : null;
			if (nachricht.user) {
				nutzerName.textContent = String(nachricht.user);
				nutzerName.hidden = false;
			}
			sendeNachricht({ type: "byom_list" });
			fussLeisteRendern();
			break;

		case "session_state":
			status = {
				modell: nachricht.model ?? null,
				thinkingLevel: nachricht.thinkingLevel ?? null,
				thinkingStufen: Array.isArray(nachricht.thinkingStufen) ? nachricht.thinkingStufen : [],
				kontext: nachricht.kontext ?? null,
			};
			fussLeisteRendern();
			break;

		case "providers":
			gespeicherteProvider = Array.isArray(nachricht.providers) ? nachricht.providers : [];
			break;

		case "byom_models":
			zeigeByomModelle(Array.isArray(nachricht.models) ? nachricht.models : []);
			break;

		case "model_changed":
			status.modell = nachricht.model ? String(nachricht.model) : null;
			fussLeisteRendern();
			break;

		case "file_uploaded":
			textInEingabeEinfuegen(nachricht.path ?? nachricht.name);
			nachrichtHinzufuegen("nachricht--hinweis", `Datei angehängt: ${nachricht.path}`);
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
			if (nachricht.on !== true) {
				aktiveAgentNachricht = null;
				denkEinklappen();
			}
			break;

		case "thought_update":
			denkTextSetzen(String(nachricht.text ?? ""));
			break;

		case "assistant_start":
			// Erste Antwort beendet den Denk-Block — er bleibt eingeklappt lesbar.
			denkEinklappen();
			aktiveAgentNachricht = elementErstellen("article", "nachricht nachricht--agent");
			aktiveAgentNachricht.appendChild(elementErstellen("div", "nachricht-rolle", "Syntax Bot"));
			verlauf.appendChild(aktiveAgentNachricht);
			nachScrollen();
			break;

		case "assistant_update":
		case "assistant_end": {
			if (!aktiveAgentNachricht) {
				aktiveAgentNachricht = elementErstellen("article", "nachricht nachricht--agent");
				aktiveAgentNachricht.appendChild(elementErstellen("div", "nachricht-rolle", "Syntax Bot"));
				verlauf.appendChild(aktiveAgentNachricht);
			}
			const koerper = aktiveAgentNachricht.querySelectorAll("p, pre, .code-block");
			koerper.forEach((el) => el.remove());
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

/** Reine Modus-Kommandos werden still gesendet — ohne eigene Chat-Blase. */
const MODUS_KOMMANDO = /^\/(syntax-fix|code-fix|cleanup|modus-aus|modus)$/;

eingabeformular.addEventListener("submit", (ereignis) => {
	ereignis.preventDefault();
	slashPopupVerbergen();
	const text = eingabe.value.trim();
	if (!text) return;

	if (!MODUS_KOMMANDO.test(text)) {
		nachrichtHinzufuegen("nachricht--nutzer", text, "Du");
	}
	sendeNachricht({ type: "user_message", text });
	eingabe.value = "";
	eingabe.focus();
});

eingabe.addEventListener("keydown", (ereignis) => {
	if (ereignis.key === "Enter" && !ereignis.shiftKey) {
		ereignis.preventDefault();
		// Offenes „/“-Popup: Enter vervollständigt statt zu senden.
		if (slashPopupOffen() && slashTreffer.length > 0) {
			eingabe.value = `/${slashTreffer[0].name} `;
			slashPopupVerbergen();
			return;
		}
		eingabeformular.requestSubmit();
	}
});

abbrechenKnopf.addEventListener("click", () => {
	sendeNachricht({ type: "interrupt" });
});

fussLeisteRendern();
verbinden();
