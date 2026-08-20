/**
 * Web-Jail — die räumliche Grenze des Web-Agenten.
 *
 * Im Web-Betrieb arbeitet Syntax Bot auf einem fremden, öffentlich erreichbaren
 * Server. Jede Session bekommt einen eigenen Arbeitsbereich, und diese Wache
 * sorgt dafür, dass kein Werkzeugaufruf diesen Bereich verlässt. Sie hängt —
 * wie die Modus-Grenzen — am `tool_call`-Ereignis und blockiert jeden Zugriff,
 * dessen Zielpfad außerhalb der Wurzel läge.
 *
 * `bash` ist im Web komplett abgeschaltet, solange der Betreiber es nicht
 * ausdrücklich erlaubt: Auf einem öffentlichen Server wäre freies bash
 * Remote-Code-Execution als Feature. Die Datei-Werkzeuge reichen für Syntax
 * Fix und Cleanup voll aus; dass Code Fix dann keine Tests ausführen kann,
 * ist der bewusste Preis des öffentlichen Betriebs. Echte Isolation mit
 * Containern pro Session ist als Phase-3-Thema notiert.
 *
 * Die Wache greift syntaktisch (resolve + relative). Sie kann keine Symlinks
 * auflösen, die aus dem Arbeitsbereich hinaus zeigen — solche Links können
 * aber ohne bash nur durch Werkzeuge entstehen, die ihrerseits der Wache
 * unterliegen.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export interface JailOptions {
	/** Wurzel des Arbeitsbereichs, über die hinaus nichts gelesen oder geschrieben werden darf. */
	root: string;
	/** Freies bash erlauben (Selbsthoster-Opt-in, entspricht SYNTAX_BOT_WEB_BASH=1). */
	allowBash?: boolean;
}

/** Werkzeuge mit optionalem Pfad-Argument — fehlt es, gilt das cwd (= Wurzel). */
const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);

/** Liegt `target` innerhalb von `root` (oder ist die Wurzel selbst)? */
export function isInsideRoot(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Baut die Jail als Inline-Extension, damit sie ausschließlich der Web-Server
 * lädt — die CLI am eigenen Rechner darf weiterhin überall hin.
 */
export function createJailExtension(options: JailOptions): InlineExtension {
	const root = resolve(options.root);
	const allowBash = options.allowBash === true;

	return {
		name: "syntax-bot-web-jail",
		hidden: true,
		factory: (pi: ExtensionAPI) => {
			pi.on("tool_call", async (event) => {
				if (event.toolName === "bash") {
					if (allowBash) return;
					return {
						block: true,
						reason:
							"Auf dem Syntax-Bot-Webserver ist die Shell deaktiviert. " +
							"Arbeite mit den Datei-Werkzeugen (read, edit, …) weiter.",
					};
				}

				if (!PATH_TOOLS.has(event.toolName)) return;

				const rawPath = (event.input as { path?: unknown }).path;
				if (typeof rawPath !== "string" || rawPath.length === 0) return;

				const target = resolve(root, rawPath);
				if (isInsideRoot(root, target)) return;

				return {
					block: true,
					reason:
						`Der Pfad „${rawPath}" liegt außerhalb des Arbeitsbereichs dieser Web-Session. ` +
						"Zugriffe sind nur innerhalb des Bereichs erlaubt.",
				};
			});
		},
	};
}
