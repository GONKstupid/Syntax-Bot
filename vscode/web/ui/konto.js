/**
 * Syntax Bot — Konto-Seite (Browser-Logik).
 *
 * Verwaltet die gespeicherten Modell-Anbieter über dieselbe WebSocket-
 * Verbindung wie der Chat. Alle Inhalte kommen ausschließlich über
 * textContent ins DOM (XSS-Sicherheit).
 */

"use strict";

const verbindung = document.getElementById("verbindung");
const nutzerName = document.getElementById("nutzer-name");
const meldungen = document.getElementById("meldungen");
const byomEndpunkt = document.getElementById("byom-endpunkt");
const byomSchluessel = document.getElementById("byom-schluessel");
const byomModell = document.getElementById("byom-modell");
const byomModellliste = document.getElementById("byom-modellliste");
const providerListe = document.getElementById("provider-liste");

let socket = null;
let aktiveProviderId = null;

function elementErstellen(tag, klasse, text) {
	const el = document.createElement(tag);
	if (klasse) el.className = klasse;
	if (text !== undefined) el.textContent = text;
	return el;
}

function sendeNachricht(nachricht) {
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(nachricht));
	}
}

function meldungHinzufuegen(level, text) {
	const klasse = level === "error" ? "konto-meldung--fehler" : "konto-meldung--hinweis";
	const el = elementErstellen("p", `konto-meldung ${klasse}`, text);
	meldungen.prepend(el);
	// Meldungsstapel klein halten — die letzten fünf reichen.
	while (meldungen.children.length > 5) meldungen.lastChild.remove();
}

/* --- Gespeicherte Anbieter -------------------------------------------- */

function providerListeRendern(provider) {
	providerListe.replaceChildren();
	if (!Array.isArray(provider) || provider.length === 0) {
		providerListe.appendChild(elementErstellen("li", "provider-leer", "Noch keine Anbieter gespeichert."));
		return;
	}
	for (const p of provider) {
		const eintrag = elementErstellen("li", "provider-eintrag");

		const info = elementErstellen("div", "provider-info");
		const name = elementErstellen("strong", "", p.displayName);
		const zeile = elementErstellen("span", "provider-zeile",
			`${p.baseUrl} · Modell: ${p.modelId}${p.hasKey ? " · API-Key hinterlegt" : ""}`);
		info.append(name, zeile);

		const knoepfe = elementErstellen("div", "provider-knoepfe");
		const aktivieren = elementErstellen("button", "knopf knopf--klein", "Verbinden");
		aktivieren.type = "button";
		aktivieren.disabled = p.providerId === aktiveProviderId;
		aktivieren.addEventListener("click", () => sendeNachricht({ type: "byom_activate", providerId: p.providerId }));
		const loeschen = elementErstellen("button", "knopf knopf--klein", "Löschen");
		loeschen.type = "button";
		loeschen.addEventListener("click", () => sendeNachricht({ type: "byom_delete", providerId: p.providerId }));
		knoepfe.append(aktivieren, loeschen);

		eintrag.append(info, knoepfe);
		providerListe.appendChild(eintrag);
	}
}

/* --- Formular ----------------------------------------------------------- */

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

/* --- Server-Nachrichten -------------------------------------------------- */

function verarbeiteNachricht(nachricht) {
	switch (nachricht.type) {
		case "ready":
			if (nachricht.user) {
				nutzerName.textContent = String(nachricht.user);
				nutzerName.hidden = false;
			}
			sendeNachricht({ type: "byom_list" });
			break;

		case "providers":
			providerListeRendern(Array.isArray(nachricht.providers) ? nachricht.providers : []);
			break;

		case "byom_models":
			zeigeByomModelle(Array.isArray(nachricht.models) ? nachricht.models : []);
			break;

		case "model_changed":
			meldungHinzufuegen("info", `Aktives Modell: ${nachricht.model ?? "unbekannt"}`);
			sendeNachricht({ type: "byom_list" });
			break;

		case "notify":
			meldungHinzufuegen(nachricht.level, nachricht.message);
			if (nachricht.level !== "error") sendeNachricht({ type: "byom_list" });
			break;
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
			// Kaputte Nachrichten dürfen die Seite nicht abreißen lassen.
		}
	});
	socket.addEventListener("close", () => {
		verbindungsstatusAnzeigen(false);
		setTimeout(verbinden, 3000);
	});
}

verbinden();
