/**
 * Diff-First: Syntax Bot schreibt nie ungefragt in eine Datei.
 *
 * Pi selbst kennt keine Bestätigung vor Schreibvorgängen — die Diff-Ansicht der
 * eingebauten Werkzeuge erscheint erst *nach* der Änderung. Deshalb fängt diese
 * Wache jeden `write`- und `edit`-Aufruf ab, berechnet den Diff vorab und lässt
 * ihn bestätigen. Gerade als LRS-Hilfsmittel ist das der Kern: es sollen keine
 * stillschweigend neuen Fehler entstehen.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { type ExtensionAPI, generateDiffString } from "@earendil-works/pi-coding-agent";

/** Der Bestätigungsdialog bleibt lesbar — lange Diffs werden gekürzt. */
const MAX_DIFF_LINES = 60;

interface EditOperation {
	oldText: string;
	newText: string;
}

/**
 * Wendet die Edits so an, wie das eingebaute `edit`-Werkzeug es tut: Jeder
 * `oldText` wird gegen den *ursprünglichen* Inhalt gesucht, die Ersetzungen
 * laufen anschließend von hinten nach vorn, damit die Offsets stabil bleiben.
 * Gibt `undefined` zurück, wenn ein Suchtext nicht eindeutig gefunden wird —
 * dann scheitert der Aufruf ohnehin und wir zeigen keinen erfundenen Diff.
 */
function applyEdits(original: string, edits: EditOperation[]): string | undefined {
	const replacements: Array<{ index: number; length: number; newText: string }> = [];

	for (const edit of edits) {
		const index = original.indexOf(edit.oldText);
		if (index === -1) return undefined;
		replacements.push({ index, length: edit.oldText.length, newText: edit.newText });
	}

	let result = original;
	for (const replacement of [...replacements].sort((a, b) => b.index - a.index)) {
		result = result.slice(0, replacement.index) + replacement.newText + result.slice(replacement.index + replacement.length);
	}
	return result;
}

function truncateDiff(diff: string): string {
	const lines = diff.split("\n");
	if (lines.length <= MAX_DIFF_LINES) return diff;
	const hidden = lines.length - MAX_DIFF_LINES;
	return `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n… (${hidden} weitere Zeilen)`;
}

interface Preview {
	title: string;
	body: string;
}

async function buildPreview(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
): Promise<Preview | undefined> {
	const rawPath = typeof input.path === "string" ? input.path : undefined;
	if (!rawPath) return undefined;

	const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	const displayPath = relative(cwd, absolutePath) || rawPath;

	let oldContent = "";
	let fileExists = true;
	try {
		oldContent = await readFile(absolutePath, "utf8");
	} catch {
		fileExists = false;
	}

	if (toolName === "write") {
		const newContent = typeof input.content === "string" ? input.content : "";
		if (!fileExists) {
			const lineCount = newContent.split("\n").length;
			return {
				title: `Neue Datei anlegen: ${displayPath}`,
				body: `Die Datei existiert noch nicht. Sie bekäme ${lineCount} Zeilen.\n\n${truncateDiff(newContent)}\n\nAnlegen?`,
			};
		}
		const { diff } = generateDiffString(oldContent, newContent, 3);
		return {
			title: `Datei überschreiben: ${displayPath}`,
			body: `${truncateDiff(diff)}\n\nÄnderungen übernehmen?`,
		};
	}

	const edits = Array.isArray(input.edits) ? (input.edits as EditOperation[]) : [];
	if (!fileExists || edits.length === 0) return undefined;

	const newContent = applyEdits(oldContent, edits);
	if (newContent === undefined) return undefined;

	const { diff } = generateDiffString(oldContent, newContent, 3);
	const label = edits.length === 1 ? "1 Änderung" : `${edits.length} Änderungen`;
	return {
		title: `${label} in ${displayPath}`,
		body: `${truncateDiff(diff)}\n\nÄnderungen übernehmen?`,
	};
}

/**
 * Hängt die Wache in die Session. Wird genau einmal aufgerufen (aus
 * `extensions/core`), damit bei einem Schreibvorgang nur ein Dialog erscheint.
 */
export function registerDiffGuard(pi: ExtensionAPI): void {
	pi.registerFlag("auto-apply", {
		description: "Änderungen ohne Diff-Rückfrage übernehmen (Diff-First deaktivieren)",
		type: "boolean",
		default: false,
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		if (pi.getFlag("auto-apply") === true) return;

		// Ohne Oberfläche (`-p`, `--mode json`) kann niemand bestätigen. Still
		// durchwinken widerspräche der Diff-First-Regel, also blockieren wir.
		if (!ctx.hasUI) {
			return {
				block: true,
				reason:
					"Diff-First: In dieser Betriebsart gibt es keine Rückfrage-Möglichkeit. " +
					"Starte Syntax Bot interaktiv oder mit --auto-apply.",
			};
		}

		const preview = await buildPreview(event.toolName, event.input as Record<string, unknown>, ctx.cwd);

		// Kein Diff berechenbar (z. B. Suchtext passt nicht) — trotzdem fragen,
		// statt die Änderung ungeprüft durchzulassen.
		const title = preview?.title ?? `Änderung an ${String((event.input as { path?: unknown }).path ?? "?")}`;
		const body = preview?.body ?? "Diff konnte nicht vorab berechnet werden. Trotzdem ausführen?";

		const confirmed = await ctx.ui.confirm(title, body);
		if (!confirmed) {
			return {
				block: true,
				reason:
					"Der Nutzer hat diese Änderung in der Diff-Vorschau abgelehnt. " +
					"Frage nach, was stattdessen passieren soll — versuche es nicht erneut mit demselben Inhalt.",
			};
		}
	});
}
