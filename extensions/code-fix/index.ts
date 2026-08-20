/**
 * Modus „Code Fix" — Syntax, echte Fehler und Struktur, ohne die Absicht des
 * Codes zu verändern.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMode } from "../shared/mode-core.ts";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "prompts");

export default function codeFixExtension(pi: ExtensionAPI): void {
	registerMode(pi, {
		id: "code-fix",
		command: "code-fix",
		label: "Code Fix",
		description: "Behebt Syntax- und Logikfehler und verbessert die Struktur.",
		greeting: "Fehler beheben und Struktur verbessern. Woran soll ich arbeiten?",
		badge: "Code Fix",

		// Der einzige Modus mit freiem Shell-Zugriff — nötig, um Tests und
		// Build-Werkzeuge auszuführen und Korrekturen zu überprüfen.
		tools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
		bash: { kind: "unrestricted" },

		promptPath: join(promptsDir, "code-fix.md"),
	});
}
