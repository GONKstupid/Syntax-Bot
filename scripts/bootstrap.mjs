#!/usr/bin/env node
/**
 * Richtet die isolierte Syntax-Bot-Instanz ein und hält sie aktuell.
 *
 * Syntax Bot benutzt bewusst **nicht** eine eventuell global installierte
 * `pi`-Version des Nutzers, sondern eine eigene Kopie unter `~/.syntax-bot/`.
 * So kann weder Syntax Bot die Einrichtung des Nutzers verändern noch
 * umgekehrt.
 *
 *   ~/.syntax-bot/runtime/   eigene npm-Installation des Pi Coding Agent
 *   ~/.syntax-bot/agent/     PI_CODING_AGENT_DIR: Sessions, auth.json, settings
 *
 * Aufruf:
 *   node scripts/bootstrap.mjs            einrichten/aktualisieren, Pfade ausgeben
 *   node scripts/bootstrap.mjs --check    nur prüfen, nichts installieren
 *   node scripts/bootstrap.mjs --force    Neuinstallation erzwingen
 *
 * Umgebungsvariablen:
 *   SYNTAX_BOT_HOME       überschreibt ~/.syntax-bot
 *   SYNTAX_BOT_NO_UPDATE  =1 überspringt die Versionsprüfung (offline)
 *   SYNTAX_BOT_PI_VERSION setzt eine feste Pi-Version statt "latest"
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot");
const agentDir = join(home, "agent");
const runtimeDir = join(home, "runtime");
const cliPath = join(runtimeDir, "node_modules", PI_PACKAGE, "dist", "cli.js");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const force = args.has("--force");

function log(message) {
	process.stderr.write(`${message}\n`);
}

function runNpm(npmArgs, options = {}) {
	// Unter Windows ist npm ein .cmd-Skript. Node lehnt es seit v20 ab, das
	// direkt zu starten; der Umweg über cmd.exe /c vermeidet zugleich
	// `shell: true` samt der Frage, wie Argumente maskiert werden müssten.
	const [command, args] =
		process.platform === "win32" ? ["cmd.exe", ["/c", "npm", ...npmArgs]] : ["npm", npmArgs];

	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
	}).trim();
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** Version der lokal installierten Pi-Kopie, oder undefined. */
function installedVersion() {
	return readJson(join(runtimeDir, "node_modules", PI_PACKAGE, "package.json"))?.version;
}

/** Neueste auf npm veröffentlichte Version, oder undefined bei fehlendem Netz. */
function latestVersion() {
	const pinned = process.env.SYNTAX_BOT_PI_VERSION;
	if (pinned) return pinned;
	try {
		return runNpm(["view", `${PI_PACKAGE}@latest`, "version"], { quiet: true });
	} catch {
		return undefined;
	}
}

function ensureRuntimeDir() {
	mkdirSync(runtimeDir, { recursive: true });
	const manifest = join(runtimeDir, "package.json");
	if (!existsSync(manifest)) {
		writeFileSync(
			manifest,
			`${JSON.stringify({ name: "syntax-bot-runtime", private: true, version: "0.0.0" }, null, 2)}\n`,
		);
	}
}

function installPi(version) {
	ensureRuntimeDir();
	log(`Installiere ${PI_PACKAGE}@${version} nach ${runtimeDir} …`);
	// --ignore-scripts: Pi braucht keine Lifecycle-Skripte, und wir führen bei
	// einem automatischen Update ungern fremden Installationscode aus.
	runNpm(["install", "--prefix", runtimeDir, "--ignore-scripts", `${PI_PACKAGE}@${version}`]);
}

/**
 * Trägt dieses Repository als Pi-Paket in die Einstellungen der isolierten
 * Instanz ein. Dadurch findet Pi die vier Syntax-Bot-Extensions, ohne dass sie
 * kopiert werden müssen — Änderungen im Repo wirken sofort.
 */
function ensurePackageRegistered() {
	mkdirSync(agentDir, { recursive: true });
	const settingsPath = join(agentDir, "settings.json");
	const settings = readJson(settingsPath) ?? {};

	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const alreadyThere = packages.some((entry) => {
		const source = typeof entry === "string" ? entry : entry?.source;
		return typeof source === "string" && resolve(source) === repoRoot;
	});

	if (alreadyThere) return false;

	settings.packages = [...packages, repoRoot];
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	log(`Syntax-Bot-Paket in ${settingsPath} eingetragen.`);
	return true;
}

function main() {
	const current = installedVersion();

	if (checkOnly) {
		const latest = latestVersion();
		log(`Installiert: ${current ?? "—"}`);
		log(`Neueste:     ${latest ?? "unbekannt (offline?)"}`);
		if (current && latest && current !== latest) log("Update verfügbar.");
		process.exit(current ? 0 : 1);
	}

	if (!current) {
		installPi(process.env.SYNTAX_BOT_PI_VERSION || "latest");
	} else if (force) {
		installPi(process.env.SYNTAX_BOT_PI_VERSION || "latest");
	} else if (process.env.SYNTAX_BOT_NO_UPDATE === "1") {
		log(`Versionsprüfung übersprungen (SYNTAX_BOT_NO_UPDATE=1), nutze ${current}.`);
	} else {
		const latest = latestVersion();
		if (!latest) {
			log(`Kein Netz — nutze die vorhandene Version ${current}.`);
		} else if (latest !== current) {
			log(`Neue Pi-Version: ${current} → ${latest}`);
			installPi(latest);
		}
	}

	if (!existsSync(cliPath)) {
		log(`Fehler: ${cliPath} nicht gefunden. Versuche es mit --force.`);
		process.exit(1);
	}

	ensurePackageRegistered();

	// Die Wrapper-Skripte lesen diese Zeilen aus.
	process.stdout.write(`SYNTAX_BOT_CLI=${cliPath}\n`);
	process.stdout.write(`SYNTAX_BOT_AGENT_DIR=${agentDir}\n`);
}

main();
