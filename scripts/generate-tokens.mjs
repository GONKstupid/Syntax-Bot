#!/usr/bin/env node
/**
 * Token-Generator: design/tokens.json ist die kanonische Quelle.
 *
 *   node scripts/generate-tokens.mjs
 *
 * Erzeugt daraus:
 *   - web/ui/tokens.css      (CSS Custom Properties, Light + Dark)
 *   - design/tokens.ansi.json (16-Farben-ANSI-Zuordnung für die CLI)
 *
 * Die erzeugten Dateien sind abgeleitet und dürfen von Hand nicht geändert
 * werden — Änderungen gehören in tokens.json, danach dieses Skript laufen
 * lassen (`npm run tokens`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensPfad = join(wurzel, "design", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPfad, "utf8"));

/** Hex (#RRGGBB) → [r, g, b]. */
function zuRgb(hex) {
	const wert = hex.replace("#", "");
	return [
		parseInt(wert.slice(0, 2), 16),
		parseInt(wert.slice(2, 4), 16),
		parseInt(wert.slice(4, 6), 16),
	];
}

/** Relativer Helligkeits-Eindruck (0 = dunkel, 1 = hell). */
function helligkeit([r, g, b]) {
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function cssSchreiben() {
	const light = Object.entries(tokens.farben.light)
		.map(([name, wert]) => `\t${name}: ${wert.toLowerCase()};`)
		.join("\n");
	const dark = Object.entries(tokens.farben.dark)
		.map(([name, wert]) => `\t\t${name}: ${wert.toLowerCase()};`)
		.join("\n");

	const inhalt = `/*
 * AUTO-GENERIERT durch scripts/generate-tokens.mjs — NICHT von Hand ändern.
 * Quelle: design/tokens.json (Herkunft/Lizenzen: design/STYLE-SOURCE.md).
 */

:root {
${light}

\t/* Abgeleitete Flächen: Diff-Zeilen tragen 12 % der Signalfarbe. */
\t--diff-add-flaeche: color-mix(in srgb, var(--diff-add) 12%, var(--bg));
\t--diff-del-flaeche: color-mix(in srgb, var(--diff-del) 12%, var(--bg));
\t/* Punktraster-Textur: so ruhig, dass sie beim Lesen nicht stört. */
\t--punkt: color-mix(in srgb, var(--text) 8%, transparent);

\t/* Schrift-Skalierung (Spec: 0,875–1,5). */
\t--font-scale: 1;
\t--fokus: 2px solid var(--accent);
}

@media (prefers-color-scheme: dark) {
\t:root {
${dark}
\t}
}
`;
	writeFileSync(join(wurzel, "web", "ui", "tokens.css"), inhalt);
}

/**
 * ANSI-Zuordnung: jede Token-Farbe wird auf den nächstliegenden der 16
 * ANSI-Grundfarben gemappt (kleinster RGB-Abstand). Die CLI nutzt diese
 * Tabelle, damit Terminal und Web dieselbe Sprache sprechen.
 */
function ansiSchreiben() {
	const grundfarben = {
		schwarz: [0, 0, 0],
		rot: [205, 49, 49],
		gruen: [13, 188, 121],
		gelb: [229, 229, 16],
		blau: [36, 114, 200],
		magenta: [188, 63, 188],
		cyan: [17, 168, 205],
		weiss: [229, 229, 229],
		"hell-schwarz": [102, 102, 102],
		"hell-rot": [241, 76, 76],
		"hell-gruen": [35, 209, 139],
		"hell-gelb": [245, 245, 67],
		"hell-blau": [59, 142, 234],
		"hell-magenta": [214, 112, 214],
		"hell-cyan": [41, 184, 219],
		"hell-weiss": [255, 255, 255],
	};

	function naechste(rgb) {
		let bester = null;
		let besterAbstand = Infinity;
		for (const [name, basis] of Object.entries(grundfarben)) {
			const abstand =
				(basis[0] - rgb[0]) ** 2 + (basis[1] - rgb[1]) ** 2 + (basis[2] - rgb[2]) ** 2;
			if (abstand < besterAbstand) {
				besterAbstand = abstand;
				bester = name;
			}
		}
		return bester;
	}

	const tabelle = {};
	for (const modus of ["light", "dark"]) {
		tabelle[modus] = {};
		for (const [name, hex] of Object.entries(tokens.farben[modus])) {
			tabelle[modus][name] = naechste(zuRgb(hex));
		}
	}

	const inhalt = JSON.stringify(
		{
			name: "syntax-bot-ansi-tokens",
			quelle: "design/tokens.json",
			hinweis: "AUTO-GENERIERT durch scripts/generate-tokens.mjs — NICHT von Hand ändern.",
			zuordnung: tabelle,
		},
		null,
		"\t",
	) + "\n";
	writeFileSync(join(wurzel, "design", "tokens.ansi.json"), inhalt);
}

cssSchreiben();
ansiSchreiben();
console.log("tokens.css und tokens.ansi.json aus design/tokens.json erzeugt.");
