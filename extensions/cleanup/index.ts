/**
 * Modus „Cleanup" — nur Struktur und Formatierung, garantiert keine
 * Logikänderung. Maßstab ist eine eigene, kurze Zusammenfassung etablierter
 * Formatierungsregeln im Prompt-Fragment (keine externe Stildatei).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FORMATTER_ALLOWLIST } from "../shared/bash-policy.ts";
import { registerMode } from "../shared/mode-core.ts";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(extensionDir, "..", "shared", "prompts");

export default function cleanupExtension(pi: ExtensionAPI): void {
	registerMode(pi, {
		id: "cleanup",
		command: "cleanup",
		label: "Cleanup",
		description: "Bereinigt Struktur und Formatierung — ohne jede Logikänderung.",
		greeting: "Struktur wird bereinigt, Logik bleibt unverändert. Welcher Code?",
		badge: "Cleanup",

		// Ohne `write`: Cleanup legt keine Dateien an, und ein vollständiges
		// Überschreiben ist genau der Weg, auf dem Logik unbemerkt verschwindet.
		// `bash` bleibt an, aber ausschließlich für Formatter und Linter.
		tools: ["read", "grep", "find", "ls", "edit", "bash"],
		bash: { kind: "allowlist", label: "Formatter und Linter", patterns: FORMATTER_ALLOWLIST },

		promptPath: join(promptsDir, "cleanup.md"),
	});
}
