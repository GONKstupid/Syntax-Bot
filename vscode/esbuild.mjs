/**
 * Baut die eigenständige VS-Code-Extension:
 *
 *   node vscode/esbuild.mjs            einmal bauen
 *   node vscode/esbuild.mjs --watch    beim Ändern neu bauen
 *
 * Es entsteht vscode/dist/ mit
 *   extension.js     — der komplette Extension-Code inkl. Pi-Laufzeit und ACP-Adapter (gebündelt)
 *   pi-package/      — Kopie von extensions/ (die Pi-Extensions samt Prompts)
 *   node_modules/    — Pakete, die zur Laufzeit als Datei daneben liegen müssen (photon WASM)
 *
 * Bewusst gebündelt statt installiert: Auf Ziel-Rechnern (Schule) gibt es kein
 * `npm install` und keine Node-Installation — die VSIX muss alles mitbringen.
 */

import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const dist = join(hier, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Die Pi-Extensions brauchen wir als echte Dateien — Pi lädt sie über den
// Pfad in settings.json ("packages"). Das Paket-Manifest (pi.extensions) und
// die Prompts werden zur Laufzeit gelesen.
cpSync(join(hier, "..", "extensions"), join(dist, "pi-package", "extensions"), { recursive: true });
cpSync(join(hier, "..", "package.json"), join(dist, "pi-package", "package.json"));

// photon-node lädt sein WASM über __dirname — gebündelt geht das nicht,
// also liegt das Paket als Datei neben dem Bundle.
mkdirSync(join(dist, "node_modules", "@silvia-odwyer"), { recursive: true });
import { existsSync as _existsSync } from "node:fs";
import { homedir as _homedir } from "node:os";
const _kandidaten = [
	join(hier, "..", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@silvia-odwyer", "photon-node"),
	join(hier, "..", "node_modules", "@silvia-odwyer", "photon-node"),
	join(_homedir(), ".syntax-bot", "runtime", "node_modules", "@silvia-odwyer", "photon-node"),
	join(_homedir(), ".syntax-bot", "runtime", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@silvia-odwyer", "photon-node"),
];
const _photonSrc = _kandidaten.find((p) => _existsSync(p));
if (!_photonSrc) throw new Error(`photon-node nicht gefunden. Kandidaten geprüft: ${_kandidaten.join(", ")}`);
cpSync(_photonSrc, join(dist, "node_modules", "@silvia-odwyer", "photon-node"), { recursive: true });

const optionen = {
	entryPoints: [join(hier, "src", "extension.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node18",
	outfile: join(dist, "extension.js"),
	sourcemap: watch ? "inline" : false,
	logLevel: "info",
	external: ["vscode", "@silvia-odwyer/photon-node"],
	define: {
		// Pi nutzt import.meta.url für __dirname-Ersatz — im CJS-Bundle fehlt das.
		"import.meta.url": "import_meta_url",
	},
	inject: [join(hier, "src", "import-meta-shim.js")],
	loader: { ".wasm": "file" },
};

const ergebnis = await (watch ? context(optionen) : build(optionen));
if (watch) {
	await ergebnis.watch();
}
