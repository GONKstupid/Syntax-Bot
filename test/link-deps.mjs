#!/usr/bin/env node
/**
 * Verlinkt die Pi-Pakete aus der isolierten Instanz in das Repo, damit die
 * Tests die Extensions genauso laden können wie Pi zur Laufzeit.
 *
 * Bewusst Links statt einer zweiten Installation: die Tests sollen gegen exakt
 * die Pi-Version laufen, die Syntax Bot auch tatsächlich benutzt.
 *
 *   node test/link-deps.mjs
 */

import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-tui", "typebox", "ws"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot");
const runtimeModules = join(home, "runtime", "node_modules");

// pi-ai, pi-tui & Co. sind Abhängigkeiten von pi-coding-agent und liegen je nach
// npm-Auflösung entweder oben oder verschachtelt darunter.
const searchRoots = [runtimeModules, join(runtimeModules, "@earendil-works", "pi-coding-agent", "node_modules")];

if (!existsSync(runtimeModules)) {
	console.error(`Pi-Runtime fehlt: ${runtimeModules}\nBitte zuerst "node scripts/bootstrap.mjs" ausführen.`);
	process.exit(1);
}

// Verzeichnis-Junctions funktionieren unter Windows auch ohne Administratorrechte.
const linkType = process.platform === "win32" ? "junction" : "dir";
let created = 0;

for (const name of PACKAGES) {
	const source = searchRoots.map((root) => join(root, name)).find((candidate) => existsSync(candidate));
	const target = join(repoRoot, "node_modules", name);

	if (!source) {
		console.error(`Übersprungen (nicht installiert): ${name}`);
		continue;
	}

	mkdirSync(dirname(target), { recursive: true });
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
	symlinkSync(source, target, linkType);
	created++;
}

console.log(`${created} Pakete nach node_modules/ verlinkt.`);
