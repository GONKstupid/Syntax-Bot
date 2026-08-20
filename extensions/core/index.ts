/**
 * Syntax-Bot-Kern.
 *
 * Alles, was es genau einmal pro Session geben darf, hängt hier — nicht in den
 * Modus-Extensions. Würde jede der drei Modus-Extensions die Diff-Wache
 * registrieren, käme bei jedem Schreibvorgang drei Mal derselbe Dialog.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDiffGuard } from "../shared/diff-guard.ts";
import { deactivateMode, getActiveMode, listModes } from "../shared/mode-core.ts";
import { registerPackageInstallTool } from "../shared/package-install.ts";

export default function syntaxBotCoreExtension(pi: ExtensionAPI): void {
	registerDiffGuard(pi);
	registerPackageInstallTool(pi);

	pi.registerCommand("modus", {
		description: "Zeigt den aktiven Modus und alle verfügbaren Modi.",
		handler: async (_args, ctx) => {
			const active = getActiveMode(ctx);
			const modes = listModes();

			const lines = modes.map((mode) => {
				const marker = mode.id === active?.id ? "▶" : " ";
				return `${marker} /${mode.command} — ${mode.description}`;
			});

			const header = active
				? `Aktiver Modus: ${active.label}`
				: "Kein Modus aktiv — Syntax Bot arbeitet ohne Einschränkung.";

			ctx.ui.notify([header, "", ...lines, "", "/modus-aus beendet den aktiven Modus."].join("\n"), "info");
		},
	});

	pi.registerCommand("modus-aus", {
		description: "Beendet den aktiven Modus und stellt den vollen Werkzeug-Zugriff wieder her.",
		handler: async (_args, ctx) => {
			const previous = deactivateMode(pi, ctx);
			ctx.ui.notify(
				previous
					? `${previous.label}-Modus beendet. Voller Werkzeug-Zugriff.`
					: "Es war kein Modus aktiv.",
				"info",
			);
		},
	});
}
