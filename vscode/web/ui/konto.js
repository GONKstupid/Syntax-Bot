/**
 * Syntax Bot — Konto-Seite (Browser-Logik).
 *
 * Verwaltet das Konto und alle drei Anmeldewege für Modell-Anbieter über
 * dieselbe WebSocket-Verbindung wie der Chat:
 *   1 — API-Key (native Provider wie Anthropic, OpenAI, …)
 *   2 — Anmeldung im Browser (OAuth/Subscription, Link erscheint hier)
 *   3 — eigener OpenAI-kompatibler Endpunkt (BYOM)
 * Alle Inhalte kommen ausschließlich über textContent ins DOM (XSS-Sicherheit).
 */

"use strict";

const verbindung = document.getElementById("verbindung");
const nutzerName = document.getElementById("nutzer-name");
const kontoInfo = document.getElementById("konto-info");
const kontoKnoepfe = document.getElementById("konto-knoepfe");
const meldungen = document.getElementById("meldungen");
const apiProvider = document.getElementById("api-provider");
const apiSchluessel = document.getElementById("api-schluessel");
const browserProvider = document.getElementById("browser-provider");
const browserHinweis = document.getElementById("browser-hinweis");
const byomEndpunkt = document.getElementById("byom-endpunkt");
const byomSchluessel = document.getElementById("byom-schluessel");
const byomModell = document.getElementById("byom-modell");
const byomModellliste = document.getElementById("byom-modellliste");
const providerListe = document.getElementById("provider-liste");

let socket = null;
let aktiveProviderId = null;
let nativeProvider = [];   // aus provider_status
let gespeicherteProvider = []; // aus providers (BYOM/custom)

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

/* --- Konto-Info ---------------------------------------------------------- */

function kontoInfoAnzeigen(user, email) {
	if (!user) return; // Ohne Konto bleibt der Hinweistext stehen.
	kontoInfo.textContent = `Angemeldet als ${user}${email ? ` (${email})` : ""}.`;
	nutzerName.textContent = user;
	nutzerName.hidden = false;
	kontoKnoepfe.hidden = false;
	document.getElementById("konto-verwaltung").hidden = false;
}

/* --- Kontoverwaltung: Passwort ändern, Konto löschen ---------------------- */

/* Passwort ein-/ausblenden — dieselben Knöpfe wie auf der Anmeldeseite. */
for (const knopf of document.querySelectorAll(".passwort-auge")) {
	knopf.addEventListener("click", () => {
		const feld = document.getElementById(knopf.dataset.feld);
		const sichtbar = feld.type === "password";
		feld.type = sichtbar ? "text" : "password";
		knopf.textContent = sichtbar ? "verbergen" : "anzeigen";
		knopf.setAttribute("aria-pressed", String(sichtbar));
	});
}

async function kontoAktion(pfad, daten) {
	const antwort = await fetch(pfad, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(daten),
	});
	let koerper = {};
	try {
		koerper = await antwort.json();
	} catch {
		// Antwort ohne JSON — der Status reicht für die Meldung.
	}
	return { ok: antwort.ok, fehler: koerper.fehler ?? `Fehler ${antwort.status}` };
}

document.getElementById("pw-speichern").addEventListener("click", async () => {
	const pwAlt = document.getElementById("pw-alt");
	const pwNeu = document.getElementById("pw-neu");
	const pwNeu2 = document.getElementById("pw-neu-2");
	if (pwNeu.value !== pwNeu2.value) {
		meldungHinzufuegen("error", "Die neuen Passwörter stimmen nicht überein.");
		pwNeu2.focus();
		return;
	}
	if (pwNeu.value.length < 8) {
		meldungHinzufuegen("error", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
		return;
	}
	const ergebnis = await kontoAktion("/auth/password", { passwortAlt: pwAlt.value, passwortNeu: pwNeu.value });
	if (ergebnis.ok) {
		meldungHinzufuegen("info", "Passwort geändert. Andere Sitzungen wurden abgemeldet.");
		pwAlt.value = "";
		pwNeu.value = "";
		pwNeu2.value = "";
	} else {
		meldungHinzufuegen("error", ergebnis.fehler);
	}
});

const loeschForm = document.getElementById("konto-loeschen-form");
document.getElementById("konto-loeschen-start").addEventListener("click", () => {
	loeschForm.hidden = false;
	document.getElementById("loesch-passwort").focus();
});
document.getElementById("konto-loeschen-abbrechen").addEventListener("click", () => {
	loeschForm.hidden = true;
	document.getElementById("loesch-passwort").value = "";
});
document.getElementById("konto-loeschen-jetzt").addEventListener("click", async () => {
	const passwort = document.getElementById("loesch-passwort").value;
	const ergebnis = await kontoAktion("/auth/delete", { passwort });
	if (ergebnis.ok) {
		location.href = "/";
		return;
	}
	meldungHinzufuegen("error", ergebnis.fehler);
});

/* --- Provider-Auswahllisten --------------------------------------------- */

function auswahlFuellen(select, provider) {
	select.replaceChildren();
	if (provider.length === 0) {
		select.appendChild(elementErstellen("option", "", "Keine Anbieter verfügbar"));
		select.disabled = true;
		return;
	}
	select.disabled = false;
	for (const p of provider) {
		const option = document.createElement("option");
		option.value = p.id;
		option.textContent = p.name;
		select.appendChild(option);
	}
}

function providerStatusRendern(provider) {
	nativeProvider = Array.isArray(provider) ? provider : [];
	auswahlFuellen(apiProvider, nativeProvider.filter((p) => p.apiKey));
	auswahlFuellen(browserProvider, nativeProvider.filter((p) => p.oauth));
	providerListeRendern();
}

/* --- Gemeinsame Anbieter-Liste (native + gespeicherte Endpunkte) --------- */

function providerListeRendern() {
	providerListe.replaceChildren();

	const nativeAngemeldet = nativeProvider.filter((p) => p.angemeldet);
	for (const p of nativeAngemeldet) {
		const eintrag = providerZeile(
			p.name,
			p.apiKey && p.oauth ? "API-Key und Browser-Anmeldung" : p.oauth ? "Browser-Anmeldung" : "API-Key",
		);
		const abmelden = elementErstellen("button", "knopf knopf--klein", "Abmelden");
		abmelden.type = "button";
		abmelden.addEventListener("click", () => sendeNachricht({ type: "provider_logout", providerId: p.id }));
		eintrag.querySelector(".provider-knoepfe").appendChild(abmelden);
		providerListe.appendChild(eintrag);
	}

	for (const p of gespeicherteProvider) {
		const zeile = `${p.baseUrl} · Modell: ${p.modelId}${p.hasKey ? " · API-Key hinterlegt" : ""}`;
		const eintrag = providerZeile(p.displayName, zeile);
		const knoepfe = eintrag.querySelector(".provider-knoepfe");

		const aktivieren = elementErstellen("button", "knopf knopf--klein", "Verbinden");
		aktivieren.type = "button";
		aktivieren.disabled = p.providerId === aktiveProviderId;
		aktivieren.addEventListener("click", () => sendeNachricht({ type: "byom_activate", providerId: p.providerId }));
		const loeschen = elementErstellen("button", "knopf knopf--klein", "Löschen");
		loeschen.type = "button";
		loeschen.addEventListener("click", () => sendeNachricht({ type: "byom_delete", providerId: p.providerId }));
		knoepfe.append(aktivieren, loeschen);
		providerListe.appendChild(eintrag);
	}

	if (providerListe.children.length === 0) {
		providerListe.appendChild(elementErstellen("li", "provider-leer", "Noch keine Anbieter gespeichert."));
	}
}

function providerZeile(name, detail) {
	const eintrag = elementErstellen("li", "provider-eintrag");
	const info = elementErstellen("div", "provider-info");
	info.append(elementErstellen("strong", "", name), elementErstellen("span", "provider-zeile", detail));
	eintrag.append(info, elementErstellen("div", "provider-knoepfe"));
	return eintrag;
}

/* --- Browser-Anmeldung: Links und Codes anzeigen ------------------------- */

function authEreignisZeigen(ereignis) {
	if (!ereignis || typeof ereignis !== "object") return;
	browserHinweis.hidden = false;
	browserHinweis.textContent = "";
	if (ereignis.type === "auth_url") {
		browserHinweis.appendChild(document.createTextNode("Bitte diesen Link öffnen und dort anmelden: "));
		const link = document.createElement("a");
		link.href = String(ereignis.url ?? "#");
		link.target = "_blank";
		link.rel = "noopener";
		link.textContent = String(ereignis.url ?? "");
		browserHinweis.appendChild(link);
	} else if (ereignis.type === "device_code") {
		browserHinweis.textContent =
			`Öffne ${ereignis.verificationUri} und gib dort diesen Code ein: ${ereignis.userCode}`;
	} else {
		browserHinweis.textContent = String(ereignis.message ?? "");
	}
}

/* --- Formulare ----------------------------------------------------------- */

document.getElementById("api-verbinden").addEventListener("click", () => {
	if (!apiProvider.value) return;
	sendeNachricht({
		type: "provider_login",
		art: "api",
		providerId: apiProvider.value,
		apiKey: apiSchluessel.value.trim(),
	});
});

document.getElementById("browser-starten").addEventListener("click", () => {
	if (!browserProvider.value) return;
	browserHinweis.hidden = false;
	browserHinweis.textContent = "Browser-Anmeldung wird gestartet …";
	sendeNachricht({ type: "provider_login", art: "oauth", providerId: browserProvider.value });
});

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
			kontoInfoAnzeigen(nachricht.user, nachricht.email);
			sendeNachricht({ type: "byom_list" });
			sendeNachricht({ type: "provider_status" });
			break;

		case "providers":
			gespeicherteProvider = Array.isArray(nachricht.providers) ? nachricht.providers : [];
			providerListeRendern();
			break;

		case "provider_status":
			providerStatusRendern(Array.isArray(nachricht.providers) ? nachricht.providers : []);
			break;

		case "provider_auth_event":
			authEreignisZeigen(nachricht.event);
			break;

		case "ui_request":
			// Rückfragen des Anmeldeflusses (z. B. Key-Eingabe) laufen im Chat —
			// hier nur kenntlich machen, dass der Server auf Eingabe wartet.
			meldungHinzufuegen("info", `Rückfrage im Chat: ${nachricht.title}`);
			break;

		case "byom_models":
			zeigeByomModelle(Array.isArray(nachricht.models) ? nachricht.models : []);
			break;

		case "model_changed":
			meldungHinzufuegen("info", `Aktives Modell: ${nachricht.model ?? "unbekannt"}`);
			sendeNachricht({ type: "byom_list" });
			sendeNachricht({ type: "provider_status" });
			break;

		case "notify":
			meldungHinzufuegen(nachricht.level, nachricht.message);
			if (nachricht.level !== "error") {
				sendeNachricht({ type: "byom_list" });
				sendeNachricht({ type: "provider_status" });
			}
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
