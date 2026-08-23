/**
 * Meta-Werkzeug für die Paketverwaltung.
 *
 * Syntax Bot soll auf einen Satz wie „Bitte installiere die Web-Access-Extension:
 * `pi install npm:pi-web-access`" reagieren können. Statt dem Modell dafür freien
 * Shell-Zugriff zu geben, gibt es genau ein Werkzeug, das ausschließlich
 * `pi install` / `pi remove` / `pi list` aufruft.
 *
 * Pi-Pakete laufen mit vollem Systemzugriff. Deshalb wird **jede** Installation
 * explizit bestätigt — auch wenn die Anfrage im Chat harmlos formuliert war.
 */

import { basename } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const parameters = Type.Object({
	action: StringEnum(["install", "remove", "list"] as const, {
		description: "install = Paket installieren, remove = entfernen, list = installierte Pakete zeigen",
	}),
	source: Type.Optional(
		Type.String({
			description:
				"Paketquelle, z. B. 'npm:pi-web-access', 'npm:@scope/paket@1.2.3', " +
				"'git:github.com/user/repo@v1' oder ein lokaler Pfad. Bei action=list weglassen.",
		}),
	),
	scope: Type.Optional(
		StringEnum(["user", "project"] as const, {
			description: "user = für alle Projekte (Standard), project = nur dieses Projekt (.pi/settings.json)",
		}),
	),
	reason: Type.Optional(
		Type.String({ description: "Ein Satz in einfacher Sprache, wofür das Paket gebraucht wird." }),
	),
});

export type PackageInstallInput = Static<typeof parameters>;

/**
 * Findet die pi-CLI der eigenen, isolierten Instanz. `process.argv[1]` ist der
 * Einstiegspunkt des laufenden Prozesses — das ist zuverlässiger als ein `pi`
 * auf dem PATH, das zu einer ganz anderen Installation des Nutzers gehören kann.
 */
function resolvePiCli(): { command: string; leadingArgs: string[] } {
	const override = process.env.SYNTAX_BOT_PI_BIN;
	if (override) return { command: override, leadingArgs: [] };

	const entry = process.argv[1];
	if (entry && /\bcli\.(js|mjs|cjs)$/.test(basename(entry))) {
		return { command: process.execPath, leadingArgs: [entry] };
	}
	return { command: "pi", leadingArgs: [] };
}

/** Grobe Plausibilitätsprüfung, bevor überhaupt ein Dialog erscheint. */
function isPlausibleSource(source: string): boolean {
	return /^(npm:|git:|https?:\/\/|ssh:\/\/|git@|\.{0,2}\/|[a-zA-Z]:[\\/])/.test(source.trim());
}

export function registerPackageInstallTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "install_pi_package",
		label: "Pi-Paket",
		description:
			"Installiert, entfernt oder listet Pi-Pakete (Extensions, Skills, Prompt-Templates, Themes) " +
			"der isolierten Syntax-Bot-Instanz. Vor jeder Installation wird der Nutzer um Bestätigung gebeten.",
		promptSnippet: "Pi-Pakete installieren, entfernen oder auflisten",
		promptGuidelines: [
			"Wenn der Nutzer um die Installation einer Extension, eines Skills oder Prompt-Templates bittet, nutze install_pi_package statt bash.",
			"Rate keine Paketnamen. Ist die Quelle unklar, frage nach der genauen Angabe (z. B. 'npm:pi-web-access').",
		],
		parameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { command, leadingArgs } = resolvePiCli();

			if (params.action === "list") {
				const result = await pi.exec(command, [...leadingArgs, "list"], { signal });
				return {
					content: [{ type: "text", text: result.stdout || result.stderr || "Keine Pakete installiert." }],
					details: { action: "list", code: result.code },
				};
			}

			const source = params.source?.trim();
			if (!source) throw new Error("Für install/remove wird 'source' benötigt, z. B. 'npm:pi-web-access'.");
			if (!isPlausibleSource(source)) {
				throw new Error(
					`"${source}" sieht nicht nach einer Paketquelle aus. Erwartet wird z. B. ` +
						"'npm:paket', 'git:github.com/user/repo' oder ein Pfad.",
				);
			}

			const scopeArgs = params.scope === "project" ? ["-l"] : [];
			const args = [...leadingArgs, params.action, ...scopeArgs, source];
			const displayCommand = `pi ${params.action}${scopeArgs.length ? " -l" : ""} ${source}`;

			// Ohne Oberfläche kann niemand zustimmen — dann wird nicht installiert.
			if (!ctx.hasUI) {
				throw new Error(
					`Installation abgebrochen: "${displayCommand}" braucht eine ausdrückliche Bestätigung, ` +
						"die in dieser Betriebsart nicht eingeholt werden kann.",
				);
			}

			const scopeText = params.scope === "project" ? "nur für dieses Projekt" : "für alle Projekte";
			const reasonText = params.reason ? `\nBegründung des Agenten: ${params.reason}\n` : "";
			const warning =
				params.action === "install"
					? "\n\n⚠ Pi-Pakete führen beliebigen Code mit deinen Rechten aus. " +
						"Installiere nur Pakete aus Quellen, denen du vertraust."
					: "";

			const confirmed = await ctx.ui.confirm(
				params.action === "install" ? "Pi-Paket installieren?" : "Pi-Paket entfernen?",
				`Auszuführender Befehl:\n  ${displayCommand}\n\nGültigkeit: ${scopeText}${reasonText}${warning}`,
			);

			if (!confirmed) {
				return {
					content: [
						{
							type: "text",
							text: `Der Nutzer hat "${displayCommand}" abgelehnt. Führe den Befehl nicht auf anderem Weg aus.`,
						},
					],
					details: { action: params.action, source, confirmed: false },
				};
			}

			const result = await pi.exec(command, args, { signal });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

			if (result.code !== 0) {
				throw new Error(`"${displayCommand}" ist fehlgeschlagen (Exit-Code ${result.code}):\n${output}`);
			}

			return {
				content: [
					{
						type: "text",
						text:
							`${displayCommand} erfolgreich.\n${output}\n\n` +
							"Hinweis: Neue Extensions werden erst nach /reload oder einem Neustart aktiv.",
					},
				],
				details: { action: params.action, source, confirmed: true, code: result.code },
			};
		},
	});
}
