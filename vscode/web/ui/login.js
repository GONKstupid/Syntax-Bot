/**
 * Syntax Bot — Anmeldeseite (Browser-Logik).
 *
 * Zwei Formulare in einem: Anmelden (Nutzername/E-Mail + Passwort) und
 * Registrieren (Nutzername + E-Mail + Passwort + Bestätigung). Beide laufen
 * als JSON-POST gegen /auth/login bzw. /auth/register; bei Erfolg geht es
 * direkt zur App. Passwörter lassen sich per „anzeigen“-Knopf einblenden.
 */

"use strict";

const formular = document.getElementById("anmeldeformular");
const umschalterAnmelden = document.getElementById("umschalter-anmelden");
const umschalterRegistrieren = document.getElementById("umschalter-registrieren");
const zeileNutzername = document.getElementById("zeile-nutzername");
const zeileEmail = document.getElementById("zeile-email");
const zeileKennung = document.getElementById("feld-kennung").closest(".einstellungen-zeile");
const feldKennung = document.getElementById("feld-kennung");
const feldNutzername = document.getElementById("feld-nutzername");
const feldEmail = document.getElementById("feld-email");
const feldPasswort = document.getElementById("feld-passwort");
const zeileWiederholung = document.getElementById("zeile-passwort-wiederholung");
const feldWiederholung = document.getElementById("feld-passwort-wiederholung");
const fehlerAnzeige = document.getElementById("anmeldung-fehler");
const absenden = document.getElementById("anmeldung-absenden");

let modus = "anmelden";

function modusSetzen(neu) {
	modus = neu;
	const registrieren = modus === "registrieren";
	umschalterAnmelden.classList.toggle("umschalter--aktiv", !registrieren);
	umschalterAnmelden.setAttribute("aria-selected", String(!registrieren));
	umschalterRegistrieren.classList.toggle("umschalter--aktiv", registrieren);
	umschalterRegistrieren.setAttribute("aria-selected", String(registrieren));

	// Registrieren: Nutzername + E-Mail + Bestätigung; Anmelden: Kennung (Name oder E-Mail).
	zeileNutzername.hidden = !registrieren;
	zeileEmail.hidden = !registrieren;
	zeileWiederholung.hidden = !registrieren;
	zeileKennung.hidden = registrieren;
	feldKennung.required = !registrieren;
	feldNutzername.required = registrieren;
	feldEmail.required = registrieren;
	feldWiederholung.required = registrieren;
	feldPasswort.autocomplete = registrieren ? "new-password" : "current-password";
	absenden.textContent = registrieren ? "Konto anlegen" : "Anmelden";
	fehlerAnzeige.hidden = true;
}

umschalterAnmelden.addEventListener("click", () => modusSetzen("anmelden"));
umschalterRegistrieren.addEventListener("click", () => modusSetzen("registrieren"));

/* Passwort ein-/ausblenden — für beide Felder, Text + Zustand doppelt kodiert. */
for (const knopf of document.querySelectorAll(".passwort-auge")) {
	knopf.addEventListener("click", () => {
		const feld = document.getElementById(knopf.dataset.feld);
		const sichtbar = feld.type === "password";
		feld.type = sichtbar ? "text" : "password";
		knopf.textContent = sichtbar ? "verbergen" : "anzeigen";
		knopf.setAttribute("aria-pressed", String(sichtbar));
	});
}

function fehlerZeigen(text) {
	fehlerAnzeige.textContent = text;
	fehlerAnzeige.hidden = false;
}

formular.addEventListener("submit", async (ereignis) => {
	ereignis.preventDefault();
	fehlerAnzeige.hidden = true;

	// Registrierung: Die Bestätigung muss mit dem Passwort übereinstimmen.
	if (modus === "registrieren" && feldPasswort.value !== feldWiederholung.value) {
		fehlerZeigen("Die Passwörter stimmen nicht überein.");
		feldWiederholung.focus();
		return;
	}
	absenden.disabled = true;

	const ziel = modus === "registrieren" ? "/auth/register" : "/auth/login";
	const daten = modus === "registrieren"
		? {
				nutzername: feldNutzername.value.trim(),
				email: feldEmail.value.trim(),
				passwort: feldPasswort.value,
			}
		: {
				kennung: feldKennung.value.trim(),
				passwort: feldPasswort.value,
			};

	try {
		const antwort = await fetch(ziel, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(daten),
		});
		if (antwort.ok) {
			location.href = "/app";
			return;
		}
		let meldung = `Fehler ${antwort.status} — bitte erneut versuchen.`;
		try {
			meldung = (await antwort.json()).fehler ?? meldung;
		} catch {
			// Antwort ohne JSON-Körper — die Statusmeldung reicht.
		}
		fehlerZeigen(meldung);
	} catch {
		fehlerZeigen("Der Server ist nicht erreichbar.");
	} finally {
		absenden.disabled = false;
	}
});

modusSetzen("anmelden");
