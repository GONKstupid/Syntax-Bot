/**
 * Chat-Webview für die VS-Code-Extension. Sprecht mit dem Extension-Host über
 * postMessage; alle Inhalte werden als Text eingefügt und erst nach dem
 * Escapen minimal als Markdown gerendert (XSS-sicher, ohne Bibliothek).
 */

/* Selbst-Diagnose: Sichtbarer Stempel + alle Fehler landen im Chat und beim
   Extension-Host, statt stumm nichts zu tun. */
const WEBVIEW_VERSION = "0.5.2";

function diagnose(text) {
	try {
		const zeile = document.createElement("div");
		zeile.className = "fehler";
		zeile.textContent = `[Diagnose] ${text}`;
		document.body.appendChild(zeile);
	} catch {
		/* letzter Ausweg */
	}
}

window.addEventListener("error", (ereignis) => {
	const detail = ereignis.error instanceof Error ? `${ereignis.error.message}\n${ereignis.error.stack ?? ""}` : String(ereignis.message);
	diagnose(`JS-Fehler: ${detail}`);
	try {
		vscodeApi.postMessage({ type: "log", text: `Webview-JS-Fehler: ${detail}` });
	} catch {}
});

try {

const verlauf = document.getElementById("verlauf");
const berechtigungen = document.getElementById("berechtigungen");
const eingabe = document.getElementById("eingabe");
const senden = document.getElementById("senden");
const anhang = document.getElementById("anhang");
const modusKnopf = document.getElementById("modusKnopf");
const modellKnopf = document.getElementById("modellKnopf");
const thinkingKnopf = document.getElementById("thinkingKnopf");
const kontextAnzeige = document.getElementById("kontext");
const menue = document.getElementById("menue");
const neuKnopf = document.getElementById("neu");
const punkteKnopf = document.getElementById("punkte");

let modi = [];
let aktuellerModus = "default";
let läuft = false;
let befehle = [];
let status = { modell: null, modelle: [], thinking: null, thinkingStufen: [], kontext: null };
let letzteSeq = 0;
const geseheneSeq = new Set();

const vscodeApi = acquireVsCodeApi();

/* Polling-Fallback: Falls die Event-Zustellung in der einen oder anderen
   Richtung klemmt, holt sich das Webview verpasste Nachrichten selbst. */
setInterval(() => {
	try {
		vscodeApi.postMessage({ type: "poll", ab: letzteSeq });
	} catch {}
}, 900);

function sendeAnHost(nachricht) { vscodeApi.postMessage(nachricht); }
/* Nie „postMessage" als Funktionsname verwenden — sie würde window.postMessage
   überschatten und damit VS Codes Nachrichten-Bridge lahmlegen. */

/* ---------- Fußleisten-Menü (einfaches Popup) ---------- */

function menueZeigen(anker, eintraege) {
	menue.textContent = "";
	for (const eintrag of eintraege) {
		const knopf = document.createElement("button");
		knopf.className = `menueEintrag${eintrag.aktiv ? " aktiv" : ""}${eintrag.klasse ? ` ${eintrag.klasse}` : ""}`;
		const titel = document.createElement("span");
		titel.textContent = eintrag.text;
		knopf.appendChild(titel);
		if (eintrag.beschreibung) {
			const beschreibung = document.createElement("span");
			beschreibung.className = "menueBeschreibung";
			beschreibung.textContent = eintrag.beschreibung;
			knopf.appendChild(beschreibung);
		}
		knopf.addEventListener("click", () => {
			menueVerbergen();
			eintrag.aktion();
		});
		menue.appendChild(knopf);
	}
	if (eintraege.length === 0) {
		const leer = document.createElement("div");
		leer.className = "menueLeer";
		leer.textContent = "Nichts vorhanden";
		menue.appendChild(leer);
	}
	menue.hidden = false;
	const feld = anker.getBoundingClientRect();
	menue.style.right = `${window.innerWidth - feld.right}px`;
	// Anker in der oberen Bildschirmhälfte → Menü DARUNTER, sonst darüber.
	menue.style.top = "";
	menue.style.bottom = "";
	if (feld.top < window.innerHeight / 2) {
		menue.style.top = `${feld.bottom + 4}px`;
	} else {
		menue.style.bottom = `${window.innerHeight - feld.top + 4}px`;
	}
}

function menueVerbergen() {
	menue.hidden = true;
}

document.addEventListener("click", (e) => {
	const ziel = e.target.closest(".fussKnopf, .kopfKnopf");
	if (!menue.hidden && !menue.contains(e.target) && !ziel) {
		menueVerbergen();
	}
});

/* Klickbare Links im Chat (z. B. Browser-Anmeldung) an den Host übergeben:
   Der öffnet sie per openExternal im System-Browser — ohne Kopieren/Einfügen. */
document.addEventListener("click", (e) => {
	const link = e.target.closest?.("a[href]");
	if (!link) return;
	const url = link.getAttribute("href") ?? "";
	if (/^https?:\/\//i.test(url)) {
		e.preventDefault();
		sendeAnHost({ type: "openLink", url });
	}
});

modusKnopf.addEventListener("click", () => {
	menueZeigen(modusKnopf, modi.map((m) => ({
		text: `${punkte(m.id)} ${m.name}`,
		beschreibung: m.beschreibung,
		aktiv: m.id === aktuellerModus,
		aktion: () => sendeAnHost({ type: "mode", id: m.id }),
	})));
});

modellKnopf.addEventListener("click", () => {
	menueZeigen(modellKnopf, status.modelle.map((id) => ({
		text: id,
		aktiv: id === status.modell,
		aktion: () => sendeAnHost({ type: "setModel", id }),
	})));
});

thinkingKnopf.addEventListener("click", () => {
	menueZeigen(thinkingKnopf, status.thinkingStufen.map((stufe) => ({
		text: stufe,
		aktiv: stufe === status.thinking,
		aktion: () => sendeAnHost({ type: "setThinking", level: stufe }),
	})));
});

/* Kopfzeile: ＋ neuer Thread, ⋯ Menü (Einstellungen, Chat-Verlauf & Co.). */

/* Verlauf komplett zurücksetzen — für neuen Thread und Thread-Wechsel. */
function verlaufLeeren() {
	verlauf.textContent = "";
	aktuelleAntwort = null;
	denkElement = null;
	denkBlock = null;
	setLaufend(false);
}

/* Neuer Thread: Der Host bricht offene Prozesse ab (z. B. Anmeldung) und
   leert den Kontext — so bekommt jeder Thread seinen eigenen Kontext. */
function neuAktion() {
	verlaufLeeren();
	sendeAnHost({ type: "newThread" });
}

neuKnopf.addEventListener("click", neuAktion);

/* Chat-Verlauf: frühere Threads als Menü; ein Klick setzt den Thread fort. */
function threadMeta(t) {
	const teile = [];
	if (t.nachrichten) teile.push(`${t.nachrichten} Nachrichten`);
	if (t.aktualisiert) {
		try {
			teile.push(new Date(t.aktualisiert).toLocaleString("de", { dateStyle: "short", timeStyle: "short" }));
		} catch { /* Datum ist zweitrangig */ }
	}
	if (t.aktiv) teile.push("(gerade offen)");
	return teile.join(" · ");
}

function threadsAnzeigen(threads) {
	const eintraege = (threads ?? []).map((t) => ({
		text: t.titel || "Thread",
		beschreibung: threadMeta(t),
		aktiv: !!t.aktiv,
		klasse: "threadEintrag",
		aktion: () => { if (t.pfad) sendeAnHost({ type: "openThread", pfad: t.pfad }); },
	}));
	if (eintraege.length === 0) {
		eintraege.push({
			text: "Noch keine früheren Threads",
			beschreibung: "Sie erscheinen hier, sobald es welche gibt.",
			klasse: "threadEintrag",
			aktion: () => {},
		});
	}
	menueZeigen(punkteKnopf, eintraege);
}

punkteKnopf.addEventListener("click", () => {
	menueZeigen(punkteKnopf, [
		{ text: "Neuer Thread", beschreibung: "/new", aktion: () => neuAktion() },
		{ text: "Chat-Verlauf", beschreibung: "Frühere Threads", aktion: () => sendeAnHost({ type: "threads" }) },
		{ text: "Einstellungen", beschreibung: "/settings", aktion: () => sendeAnHost({ type: "prompt", text: "/settings" }) },
		{ text: "Thread als Markdown exportieren", beschreibung: ".md", aktion: () => sendeAnHost({ type: "exportMd" }) },
		{ text: "Hilfe", beschreibung: "/help", aktion: () => sendeAnHost({ type: "prompt", text: "/help" }) },
		{ text: "Werkzeuge", beschreibung: "/tools", aktion: () => sendeAnHost({ type: "prompt", text: "/tools" }) },
		{ text: "Statistik", beschreibung: "/stats", aktion: () => sendeAnHost({ type: "prompt", text: "/stats" }) },
		{ text: "Anmelden", beschreibung: "/login", aktion: () => sendeAnHost({ type: "prompt", text: "/login" }) },
	]);
});

/* ---------- „/“-Popup ---------- */

const popup = document.createElement("div");
popup.className = "menue slashPopup";
popup.hidden = true;
document.body.appendChild(popup);
let popupTreffer = [];

eingabe.addEventListener("input", () => slashPopupAktualisieren());

function slashPopupAktualisieren() {
	const text = eingabe.value;
	if (!text.startsWith("/") || text.includes(" ")) {
		popup.hidden = true;
		return;
	}
	// Commands noch nicht bekannt? Zustand aktiv anfordern.
	if (befehle.length === 0) {
		sendeAnHost({ type: "hello" });
	}
	const fragment = text.slice(1).toLowerCase();
	popupTreffer = befehle.filter((b) => b.name.toLowerCase().startsWith(fragment));
	if (popupTreffer.length === 0) {
		popup.hidden = true;
		return;
	}
	popup.textContent = "";
	for (const befehl of popupTreffer) {
		const zeile = document.createElement("button");
		zeile.className = "menueEintrag";
		const name = document.createElement("span");
		name.textContent = `/${befehl.name}`;
		const beschreibung = document.createElement("span");
		beschreibung.className = "menueBeschreibung";
		beschreibung.textContent = befehl.description ?? "";
		zeile.append(name, beschreibung);
		zeile.addEventListener("click", () => {
			eingabe.value = `/${befehl.name} `;
			popup.hidden = true;
			eingabe.focus();
		});
		popup.appendChild(zeile);
	}
	popup.hidden = false;
	const feld = eingabe.getBoundingClientRect();
	popup.style.left = `${feld.left}px`;
	popup.style.bottom = `${window.innerHeight - feld.top + 4}px`;
}

/* ---------- Fußleisten-Anzeigen ---------- */

function punkte(modusId) {
	// Spec: Syntax Fix ●○○ · Code Fix ●●○ · Cleanup ◐◐◐
	switch (modusId) {
		case "syntax-fix": return "●○○";
		case "code-fix": return "●●○";
		case "cleanup": return "◐◐◐";
		default: return "○○○";
	}
}

function fussLeisteRendern() {
	const modus = modi.find((m) => m.id === aktuellerModus);
	modusKnopf.textContent = "";
	const modusPunkte = document.createElement("span");
	modusPunkte.textContent = punkte(aktuellerModus);
	const modusEtikett = document.createElement("span");
	modusEtikett.className = "etikett";
	modusEtikett.textContent = modus?.name ?? "Modus";
	modusKnopf.append(modusPunkte, modusEtikett);
	modusKnopf.classList.toggle("aktiv", aktuellerModus !== "default");

	modellKnopf.textContent = "";
	const modellEtikett = document.createElement("span");
	modellEtikett.className = "etikett";
	modellEtikett.textContent = status.modell ?? "Modell";
	modellKnopf.appendChild(modellEtikett);

	thinkingKnopf.textContent = "";
	const thinkEtikett = document.createElement("span");
	thinkEtikett.className = "etikett";
	thinkEtikett.textContent = status.thinking ? `Think:${status.thinking}` : "Think";
	thinkingKnopf.appendChild(thinkEtikett);

	kontextAnzeige.textContent = status.kontext ? `${status.kontext.prozent}%` : "—";
	kontextAnzeige.title = status.kontext
		? `Kontext: ${status.kontext.tokens} von ${status.kontext.fenster ?? "?"} Tokens`
		: "Noch keine Kontextdaten";
}

/* ---------- Markdown (minimal) ---------- */

function escapen(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

function markdown(text) {
	// Fenced Code-Blöcke zuerst herausziehen — mit Kopfzeile und Kopier-Knopf.
	const bloecke = [];
	text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, sprache, code) => {
		const sauber = code.replace(/\n$/, "");
		bloecke.push(
			`<div class="codeBlock"><div class="codeKopf"><span class="codeSprache">${escapen(sprache || "code")}</span>` +
				`<button type="button" class="copyKnopf">Kopieren</button></div>` +
				`<pre><code>${escapen(sauber)}</code></pre></div>`,
		);
		return `\u0000${bloecke.length - 1}\u0000`;
	});

	let html = escapen(text);
	html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
	html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

	// Zeilengruppen zu Absätzen.
	html = html
		.split(/\n{2,}/)
		.map((absatz) => (/^\u0000\d+\u0000$/.test(absatz.trim()) || absatz.includes("<h") ? absatz : `<p>${absatz.replace(/\n/g, "<br>")}</p>`))
		.join("");

	html = html.replace(/\u0000(\d+)\u0000/g, (_m, i) => bloecke[Number(i)]);
	return html;
}

/* ---------- Verlauf ---------- */

function nachrichtHinzufuegen(rolle, klasse) {
	const element = document.createElement("section");
	element.className = `nachricht ${klasse}`;
	const kopf = document.createElement("div");
	kopf.className = "rolle";
	kopf.textContent = rolle;
	const koerper = document.createElement("div");
	koerper.className = "md";
	element.append(kopf, koerper);
	verlauf.appendChild(element);
	verlauf.scrollTop = verlauf.scrollHeight;
	return { element, koerper };
}

let aktuelleAntwort = null;
let denkElement = null;
let denkBlock = null;
let arbeitenZeile = null;

/* Arbeits-Anzeige: kleine Animation, solange Syntax Bot an einer Antwort
   arbeitet (wie in üblichen Chat-Oberflächen). */
function arbeitAnzeigen(sichtbar) {
	if (sichtbar) {
		if (arbeitenZeile) return;
		arbeitenZeile = document.createElement("div");
		arbeitenZeile.className = "arbeitenZeile";
		const text = document.createElement("span");
		text.textContent = "Syntax Bot arbeitet";
		const punkte = document.createElement("span");
		punkte.className = "arbeitenPunkte";
		punkte.setAttribute("aria-hidden", "true");
		arbeitenZeile.append(text, punkte);
		verlauf.appendChild(arbeitenZeile);
		verlauf.scrollTop = verlauf.scrollHeight;
	} else if (arbeitenZeile) {
		arbeitenZeile.remove();
		arbeitenZeile = null;
	}
}

function denkBlockErzeugen() {
	const { element, koerper } = nachrichtHinzufuegen("", "bot denken");
	const kopf = document.createElement("button");
	kopf.type = "button";
	kopf.className = "denkenKopf";
	const icon = document.createElement("span");
	icon.className = "denkenIcon";
	icon.setAttribute("aria-hidden", "true");
	icon.textContent = "💡";
	const etikett = document.createElement("span");
	etikett.textContent = "Denkprozess";
	const status = document.createElement("span");
	status.className = "denkenStatus";
	status.textContent = "denkt …";
	const pfeil = document.createElement("span");
	pfeil.className = "denkenPfeil";
	pfeil.setAttribute("aria-hidden", "true");
	pfeil.textContent = "▾";
	kopf.append(icon, etikett, status, pfeil);
	kopf.addEventListener("click", () => element.classList.toggle("eingeklappt"));
	kopf.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			element.classList.toggle("eingeklappt");
		}
	});
	element.querySelector(".rolle").replaceWith(kopf);
	return { element, koerper };
}

function denkTextAnhaengen(text) {
	// Denk-Protokoll während des Denkens lesbar (offen, mit 💡-Icon);
	// eingeklappt wird es erst, wenn die Antwort beginnt oder der Zug endet.
	if (!denkElement) {
		const block = denkBlockErzeugen();
		denkBlock = block.element;
		denkElement = block.koerper;
	}
	denkBlock.classList.remove("eingeklappt", "fertig");
	denkElement.textContent += text;
	verlauf.scrollTop = verlauf.scrollHeight;
}

function denkEinklappen() {
	if (denkBlock) {
		denkBlock.classList.add("eingeklappt", "fertig");
	}
	denkElement = null;
}

function antwortTextAnhaengen(text) {
	// Erste Antwort beendet den Denk-Block und klappt ihn ein — der Inhalt
	// bleibt per Klick auf die Kopfzeile einsehbar.
	denkEinklappen();
	if (!aktuelleAntwort) {
		aktuelleAntwort = { roh: "", werkzeuge: new Map() };
	}
	aktuelleAntwort.roh += text;
	aktuelleAntwort.ziel ??= nachrichtHinzufuegen("Syntax Bot", "bot").koerper;
	renderMarkdownIn(aktuelleAntwort.ziel, aktuelleAntwort.roh);
}

function renderMarkdownIn(ziel, roh) {
	ziel.innerHTML = markdown(roh);
	verlauf.scrollTop = verlauf.scrollHeight;
}

/* Kopier-Knöpfe in Code-Blöcken: per Delegation, weil der Markdown-Renderer
   die Blöcke neu aufbaut (Listener würden sonst verloren gehen). */
verlauf.addEventListener("click", async (ereignis) => {
	const knopf = ereignis.target.closest?.(".copyKnopf");
	if (!knopf) return;
	const codeText = knopf.closest(".codeBlock")?.querySelector("pre code")?.textContent ?? "";
	let ok = false;
	try {
		await navigator.clipboard.writeText(codeText);
		ok = true;
	} catch {
		// Rückfall für Umgebungen ohne Clipboard-API (z. B. alte Webview-Builds).
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

function fehlerAnzeigen(text) {
	const { koerper } = nachrichtHinzufuegen("Fehler", "fehler meldung");
	koerper.textContent = text;
}

/* ---------- Modi-Leiste ---------- */

function modusLeisteRendern() {
	fussLeisteRendern();
}

/* ---------- Diff-/Berechtigungsdialog ---------- */

function berechtigungZeigen(nachricht) {
	const karte = document.createElement("div");
	karte.className = "berechtigung";
	const frage = document.createElement("div");
	frage.className = "frage";
	frage.textContent = nachricht.frage || "Änderung übernehmen?";
	const aktionen = document.createElement("div");
	aktionen.className = "berechtigungenAktionen";

	for (const option of nachricht.optionen ?? []) {
		const knopf = document.createElement("button");
		const istJa = option.id === "ja";
		knopf.className = `aktion ${istJa ? "ja" : "nein"}`;
		knopf.textContent = option.text;
		knopf.addEventListener("click", () => {
			karte.remove();
			sendeAnHost({ type: "permission", optionId: option.id });
		});
		aktionen.appendChild(knopf);
	}

	karte.append(frage, aktionen);
	berechtigungen.appendChild(karte);
	frage.scrollIntoView({ block: "nearest" });
}

/* ---------- Werkzeug-Anzeige ---------- */

function werkzeugVerarbeiten(update) {
	if (update.sessionUpdate === "tool_call") {
		const zeile = document.createElement("div");
		zeile.className = "werkzeug laufend";
		zeile.dataset.toolCallId = update.toolCallId ?? "";
		zeile.textContent = `▸ ${update.title ?? "Werkzeug"} …`;
		verlauf.appendChild(zeile);
	} else if (update.sessionUpdate === "tool_call_update") {
		const zeile = verlauf.querySelector(`[data-tool-call-id="${CSS.escape(String(update.toolCallId ?? ""))}"]`);
		if (zeile) {
			zeile.classList.remove("laufend");
			zeile.textContent = `${update.status === "failed" ? "✗" : "✓"} ${zeile.textContent.replace(/^▸ /, "").replace(/ …$/, "")}`;
		}
	}
}

/* ---------- Nachrichten vom Host ---------- */

window.addEventListener("message", (ereignis) => {
	let n = ereignis.data;
	// Toleranz: Manche Wirte liefern Strings statt Objekte.
	if (typeof n === "string") {
		try { n = JSON.parse(n); } catch { return; }
	}
	if (!n || typeof n !== "object") return;
	// Duplikate überspringen (Push + Poll können sich überlappen).
	if (typeof n.seq === "number") {
		if (geseheneSeq.has(n.seq)) return;
		geseheneSeq.add(n.seq);
		if (n.seq > letzteSeq) letzteSeq = n.seq;
	}
	switch (n.type) {
		case "state":
			if (Array.isArray(n.modi)) modi = n.modi;
			if (n.aktuellerModus) aktuellerModus = n.aktuellerModus;
			if (Array.isArray(n.befehle)) befehle = n.befehle;
			status = {
				modell: n.modell ?? null,
				modelle: n.modelle ?? [],
				thinking: n.thinking ?? null,
				thinkingStufen: n.thinkingStufen ?? [],
				kontext: n.kontext ?? null,
			};
			fussLeisteRendern();
			break;
		case "ready":
			modi = n.modes ?? [];
			aktuellerModus = n.currentModeId ?? "default";
			if (Array.isArray(n.befehle)) befehle = n.befehle;
			fussLeisteRendern();
			break;
		case "sessionStatus":
			status = {
				modell: n.modell ?? null,
				modelle: n.modelle ?? [],
				thinking: n.thinking ?? null,
				thinkingStufen: n.thinkingStufen ?? [],
				kontext: n.kontext ?? null,
			};
			fussLeisteRendern();
			break;
		case "userText":
			// Wird jetzt schon lokal beim Senden gezeigt — hier nur absichern.
			denkElement = null;
			denkBlock = null;
			aktuelleAntwort = null;
			setLaufend(true);
			break;
		case "update":
			if (n.update.sessionUpdate === "agent_message_chunk") {
				antwortTextAnhaengen(n.update.content?.text ?? "");
			} else if (n.update.sessionUpdate === "agent_thought_chunk") {
				denkTextAnhaengen(n.update.content?.text ?? "");
			} else if (n.update.sessionUpdate === "available_commands_update") {
				befehle = n.update.availableCommands ?? [];
			} else if (n.update.sessionUpdate === "tool_call" || n.update.sessionUpdate === "tool_call_update") {
				werkzeugVerarbeiten(n.update);
			} else if (n.update.sessionUpdate === "current_mode_update") {
				aktuellerModus = String(n.update.currentModeId ?? "default");
				fussLeisteRendern();
			}
			break;
		case "permission":
			berechtigungZeigen(n);
			break;
		case "modeChanged":
			aktuellerModus = n.currentModeId;
			fussLeisteRendern();
			nachrichtHinzufuegen("", "bot").koerper.textContent =
				`Modus: ${modi.find((m) => m.id === aktuellerModus)?.name ?? aktuellerModus}`;
			break;
		case "insertText": {
			const start = eingabe.selectionStart ?? eingabe.value.length;
			eingabe.value = eingabe.value.slice(0, start) + n.text + eingabe.value.slice(start);
			eingabe.focus();
			break;
		}
		case "status":
			nachrichtHinzufuegen("", "bot").koerper.textContent = n.text;
			break;
		case "ping":
			sendeAnHost({ type: "log", text: "pong" });
			break;
		case "turnEnd":
			setLaufend(false);
			// Zug vorbei: offenen Denk-Block einklappen.
			denkEinklappen();
			break;
		case "threads":
			threadsAnzeigen(n.threads);
			break;
		case "threadNeu":
			verlaufLeeren();
			break;
		case "threadGeladen": {
			// Alten Thread fortsetzen: Verlauf leeren und die gespeicherten
			// Nachrichten wiederherstellen — der Kontext bleibt erhalten.
			verlaufLeeren();
			for (const eintrag of n.verlauf ?? []) {
				if (eintrag.rolle === "nutzer") {
					nachrichtHinzufuegen("Du", "nutzer").koerper.textContent = eintrag.text;
				} else {
					renderMarkdownIn(nachrichtHinzufuegen("Syntax Bot", "bot").koerper, eintrag.text);
				}
			}
			nachrichtHinzufuegen("", "bot").koerper.textContent =
				"Thread geladen — du kannst hier direkt weiterarbeiten.";
			break;
		}
		case "error":
			fehlerAnzeigen(n.text);
			setLaufend(false);
			break;
	}
});

function setLaufend(zustand) {
	läuft = zustand;
	senden.textContent = läuft ? "■" : "➤";
	senden.title = läuft ? "Abbrechen" : "Senden";
	eingabe.disabled = false;
	arbeitAnzeigen(zustand);
}

/* ---------- Eingabe ---------- */

function sendOderStop() {
	popup.hidden = true;
	if (läuft) {
		sendeAnHost({ type: "stop" });
		return;
	}
	const text = eingabe.value.trim();
	eingabe.value = "";
	if (!text) {
		// Leere Eingabe = gültige Antwort auf Chat-Rückfragen („kein Key nötig").
		sendeAnHost({ type: "prompt", text: "-" });
		return;
	}
	// Eigene Nachricht SOFORT zeigen — nicht erst nach dem Rundtrip.
	denkElement = null;
	denkBlock = null;
	nachrichtHinzufuegen("Du", "nutzer").koerper.textContent = text;
	aktuelleAntwort = null;
	setLaufend(true);
	sendeAnHost({ type: "prompt", text });
}

senden.addEventListener("click", sendOderStop);
anhang.addEventListener("click", () => sendeAnHost({ type: "pickFile" }));
eingabe.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault();
		// „/“-Popup offen? Enter vervollständigt statt zu senden.
		if (!popup.hidden && popupTreffer.length > 0) {
			eingabe.value = `/${popupTreffer[0].name} `;
			popup.hidden = true;
			return;
		}
		sendOderStop();
	}
	if (e.key === "Escape") {
		popup.hidden = true;
		menueVerbergen();
	}
});

/* Stempel unten — zeigt, dass dieses Skript wirklich läuft. */
const stempel = document.createElement("div");
stempel.style.cssText = "flex:none;padding:2px 12px;font-size:10px;opacity:.5;border-top:1px solid var(--border)";
stempel.textContent = `webview ${WEBVIEW_VERSION}`;
document.body.appendChild(stempel);

/* Meldung an den Host ERST NUN — alle Listener sind registriert. Früh
   gesendete/empfangene Nachrichten verwirft VS Code (siehe Adapter-Kommentar). */
sendeAnHost({ type: "hello" });
sendeAnHost({ type: "log", text: "Webview geladen, Skript läuft." });
} catch (fehler) {
	diagnose(`Init-Fehler: ${fehler instanceof Error ? fehler.stack : String(fehler)}`);
}
