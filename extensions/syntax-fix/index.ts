/**
 * Modus „Syntax Fix" — korrigiert ausschließlich Rechtschreibung und Syntax.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMode } from "../shared/mode-core.ts";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "prompts");

export default function syntaxFixExtension(pi: ExtensionAPI): void {
	registerMode(pi, {
		id: "syntax-fix",
		command: "syntax-fix",
		label: "Syntax Fix",
		description: "Korrigiert ausschließlich Rechtschreib- und Syntaxfehler — keine Logikänderung.",
		greeting: "Nur Rechtschreibung und Syntax. Worauf soll ich schauen?",
		badge: "Syntax Fix",

		// Bewusst ohne `write` und ohne `bash`: Tippfehler lassen sich immer als
		// gezielter Edit beheben. Ein kompletter Datei-Überschreiber ist genau
		// der Weg, auf dem in diesem Modus unbemerkt Logik verloren ginge.
		tools: ["read", "grep", "find", "ls", "edit"],
		bash: { kind: "blocked" },

		promptPath: join(promptsDir, "syntax-fix.md"),
	});
}
