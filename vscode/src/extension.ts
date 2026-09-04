/**
 * Syntax Bot als eigenständige VS-Code-Extension.
 *
 * Anders als die Zed-Anbindung (ide/index.ts) gibt es hier keinen
 * Unterprozess und keine isolierte Instanz auf Platte: Die Pi-Laufzeit läuft
 * gebündelt im Extension-Host, der ACP-Adapter wird über zwei gekreuzte
 * In-Memory-Verbindungen angesprochen (gleiches Muster wie in den Tests) und
 * das Konfigurations-Home liegt im von VS Code verwalteten globalStorage.
 *
 * Ergebnis: Auf Rechnern ohne Node und ohne Installationsrechte genügt die
 * VSIX — Chat, Diff-Dialog und Modi laufen wie in Zed, nur im Webview-Panel.
 */

import * as vscode from "vscode";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AcpVerbindung, type RpcNotification, type RpcRequest } from "../../ide/acp";
import { AcpAdapter } from "../../ide/adapter";

/** Eine laufende Chat-Verbindung: Webview ↔ ACP-Adapter (in-process). */
export class ChatSitzung implements vscode.Disposable {
	private readonly adapter: AcpAdapter;
	private server!: AcpVerbindung;
	private client!: AcpVerbindung;
	private sessionId?: string;
	private modi: Array<{ id: string; name: string }> = [];
	private aktuellerModus = "default";
	private befehle: Array<{ name: string; description: string; hint?: string }> = [];
	private laufend = false;
	private berechtigungOffen?: { erledigen: (ergebnis: unknown) => void };
	/** Ausgehende Nachrichten mit Sequenznummer — Polling-Fallback fürs Webview. */
	private folge = 0;
	private warteschlange: Array<{ seq: number; nachricht: Record<string, unknown> }> = [];
	/** Transkript des Threads für den Markdown-Export. */
	private transkript: string[] = [];
	private assistentEntwurf?: string[];
	private nutzerImZug = false;
	/**
	 * Erst senden, wenn sich die Seite gemeldet hat: postMessage vor der
	 * Listener-Registrierung im Webview wird von VS Code verworfen und kann
	 * den Kanal dauerhaft blockieren (microsoft/vscode#125546).
	 */
	private bereit = false;
	private gepuffert: Array<Record<string, unknown>> = [];

	constructor(
		private readonly webview: vscode.Webview,
		agentDir: string,
		private readonly cwd: string,
		private readonly protokollieren: (text: string) => void = () => {},
	) {
		this.adapter = new AcpAdapter({ agentDir });
	}

	/** Läuft mit Protokollierung und Timeout, damit Hänger sichtbar werden. */
	async starten(): Promise<void> {
		const adapter = this.adapter;
		const schritt = (text: string) => {
			this.protokollieren(`[starten] ${text}`);
			this.sende({ type: "status", text });
		};

		this.server = new AcpVerbindung(
			(zeile) => this.client.daten(`${zeile}\n`),
			(anfrage) => adapter.anfrage(this.server, anfrage),
			() => {},
		);
		this.client = new AcpVerbindung(
			(zeile) => this.server.daten(`${zeile}\n`),
			(anfrage) => this.clientAnfrage(anfrage),
			(benachrichtigung) => this.aufUpdate(benachrichtigung),
		);

		schritt("ACP-Verbindung steht — initialize …");
		await this.client.anfragen("initialize", {
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
		});

		schritt("Pi-Session wird erstellt (kann beim ersten Mal kurz dauern) …");
		const mitTimeout = Promise.race([
			this.client.anfragen("session/new", { cwd: this.cwd }),
			new Promise((_erledigen, ablehnen) =>
				setTimeout(() => ablehnen(new Error("session/new nach 60 s nicht beantwortet — siehe Protokoll")), 60_000),
			),
		]);
		const ergebnis = (await mitTimeout) as {
			sessionId: string;
			modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name: string }> };
		};
		this.sessionId = ergebnis.sessionId;
		this.protokollieren(`Session bereit (${this.sessionId}).`);
		this.modi = ergebnis.modes?.availableModes ?? [];
		this.aktuellerModus = ergebnis.modes?.currentModeId ?? "default";

		this.sende({
			type: "ready",
			modes: this.modi,
			currentModeId: this.aktuellerModus,
			befehle: this.befehle,
		});
		schritt("Bereit.");
		await this.zustandSenden();
	}

	dispose(): void {
		this.adapter.schliessen();
		this.client?.schliessen();
		this.server?.schliessen();
	}

	private sende(nachricht: Record<string, unknown>): void {
		const seq = ++this.folge;
		const voll = { ...nachricht, seq };
		this.warteschlange.push({ seq, nachricht: voll });
		if (this.warteschlange.length > 80) this.warteschlange.splice(0, this.warteschlange.length - 80);
		if (!this.bereit) {
			this.protokollieren(`→ Webview: ${String(nachricht.type)} #${seq} (gepuffert — Seite noch nicht bereit)`);
			this.gepuffert.push(voll);
			return;
		}
		this.sendeDirekt(voll);
	}

	private sendeDirekt(voll: Record<string, unknown>): void {
		void this.webview.postMessage(voll).then((zugestellt) => {
			this.protokollieren(`→ Webview: ${String(voll.type)} #${String(voll.seq)} (zugestellt: ${zugestellt})`);
		}, (fehler: unknown) => {
			this.protokollieren(`→ Webview FEHLER bei ${String(voll.type)}: ${String(fehler)}`);
		});
	}

	/** Polling-Fallback: Webview fordert alles ab `ab` an, falls Events verloren gehen. */
	private pollBeantworten(ab: number): void {
		for (const eintrag of this.warteschlange) {
			if (eintrag.seq > ab) {
				void this.webview.postMessage({ ...eintrag.nachricht, seq: eintrag.seq });
			}
		}
	}

	/** Benachrichtigungen des Adapters (Chunks, Tool-Calls, Commands, Modus). */
	private aufUpdate(benachrichtigung: RpcNotification): void {
		if (benachrichtigung.method === "syntax-bot/refresh") {
			// Adapter meldet: Provider/Modell haben sich geändert — Status neu holen.
			void this.statusNachreichen();
			return;
		}
		if (benachrichtigung.method !== "session/update") return;
		const params = benachrichtigung.params as { update?: Record<string, unknown> } | undefined;
		if (!params?.update) return;
		const update = params.update;
		if (update.sessionUpdate === "available_commands_update") {
			this.befehle = (update.availableCommands as typeof this.befehle) ?? [];
		}
		if (update.sessionUpdate === "current_mode_update") {
			this.aktuellerModus = String(update.currentModeId ?? "default");
		}
		if (update.sessionUpdate === "agent_message_chunk") {
			// Transkript für den Markdown-Export mitschreiben.
			const text = String((update.content as { text?: unknown })?.text ?? "");
			if (!this.assistentEntwurf) this.assistentEntwurf = [];
			this.assistentEntwurf.push(text);
		}
		this.sende({ type: "update", update });
	}

	/** Anfragen des Adapters an den „Editor" — bei uns: der Diff-Dialog im Webview. */
	private clientAnfrage(anfrage: RpcRequest): Promise<unknown> {
		if (anfrage.method === "session/request_permission") {
			const params = (anfrage.params ?? {}) as {
				options?: Array<{ optionId: string; name: string }>;
				_meta?: { frage?: string };
			};
			const frage = params._meta?.frage ?? "";
			const optionen = params.options ?? [];
			return new Promise((erledigen) => {
				// Eine offene Rückfrage wird durch die nächste ersetzt (ablehnen).
				this.berechtigungOffen?.erledigen({ outcome: { outcome: "cancelled" } });
				this.berechtigungOffen = { erledigen };
				this.sende({
					type: "permission",
					id: anfrage.id,
					frage,
					optionen: optionen.map((option) => ({ id: option.optionId, text: option.name })),
				});
			});
		}
		throw new Error(`Methode nicht unterstützt: ${anfrage.method}`);
	}

	/** Antwortentwürfe des laufenden Zugs ins Transkript übernehmen. */
	private transkriptFlushen(): void {
		const text = (this.assistentEntwurf ?? []).join("").trim();
		this.assistentEntwurf = undefined;
		if (!text) return;
		if (this.nutzerImZug) {
			this.transkript.push(`## Syntax Bot\n\n${text}`);
			this.nutzerImZug = false;
		} else {
			// Chunks außerhalb eines Zugs (Hinweise, Login-Dialoge) anhängen.
			const letzter = this.transkript.at(-1);
			if (letzter?.startsWith("## Syntax Bot")) {
				this.transkript[this.transkript.length - 1] += `\n\n${text}`;
			} else {
				this.transkript.push(`## Syntax Bot\n\n${text}`);
			}
		}
	}

	/** Holt Status (Modell/Thinking/Kontext) und reicht ihn an das Webview. */
	private async statusNachreichen(): Promise<void> {
		if (!this.sessionId) return;
		try {
			const status = (await this.client.anfragen("session/status", { sessionId: this.sessionId })) as Record<
				string,
				unknown
			>;
			this.sende({ type: "sessionStatus", ...status });
		} catch {
			/* Status ist optional — im Chat fehlt dann eben die Anzeige. */
		}
	}

	/** Ein einziges „state"-Paket mit allem, was die Fußleiste braucht. */
	private async zustandSenden(): Promise<void> {
		if (!this.sessionId) {
			this.sende({ type: "status", text: "Verbinde …" });
			return;
		}
		let status: Record<string, unknown> = {};
		try {
			status = (await this.client.anfragen("session/status", { sessionId: this.sessionId })) as Record<
				string,
				unknown
			>;
		} catch {
			/* Status ist optional. */
		}
		this.sende({
			type: "state",
			modi: this.modi,
			aktuellerModus: this.aktuellerModus,
			befehle: this.befehle,
			...status,
		});
	}

	/** Nachricht aus dem Webview. */
	async nachricht(nachricht: Record<string, unknown>): Promise<void> {
		switch (nachricht.type) {
			case "hello":
				// Die Seite hat ihren Listener registriert — jetzt erst freigeben
				// und alles Gepufferte mit kleinem Abstand nachschieben.
				if (!this.bereit) {
					this.bereit = true;
					const gepuffert = this.gepuffert.splice(0);
					setTimeout(() => {
						for (const m of gepuffert) this.sendeDirekt(m);
						void this.zustandSenden();
					}, 60);
					this.sende({ type: "status", text: "Verbinde …" });
					this.sende({ type: "ping" });
				} else {
					void this.zustandSenden();
				}
				break;
			case "pickFile": {
				// „+“ im Webview: Datei aus dem Workspace wählen und als @pfad einfügen.
				const dateien = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 200);
				const aktiv = vscode.window.activeTextEditor?.document.uri.fsPath;
				const wahl = await vscode.window.showQuickPick(
					dateien.map((uri) => ({
						label: uri.fsPath,
						description: uri.fsPath === aktiv ? "(aktive Datei)" : undefined,
						pfad: uri.fsPath,
					})),
					{ placeHolder: "Datei als Kontext einfügen" },
				);
				if (wahl) this.sende({ type: "insertText", text: `@${wahl.pfad} ` });
				break;
			}
			case "prompt": {
				const text = String(nachricht.text ?? "").trim();
				if (!text || !this.sessionId || this.laufend) return;
				this.laufend = true;
				if (text === "/new") this.transkript = [];
				this.transkript.push(`## Du\n\n${text}`);
				this.assistentEntwurf = undefined;
				this.nutzerImZug = true;
				this.sende({ type: "userText", text });
				try {
					await this.client.anfragen("session/prompt", {
						sessionId: this.sessionId,
						prompt: [{ type: "text", text }],
					});
				} catch (fehler) {
					this.sende({
						type: "error",
						text: fehler instanceof Error ? fehler.message : String(fehler),
					});
				} finally {
					this.laufend = false;
					this.transkriptFlushen();
					this.sende({ type: "turnEnd" });
					await this.statusNachreichen();
				}
				break;
			}
			case "exportMd": {
				// Thread als Markdown-Datei speichern.
				const inhalt =
					`# Syntax-Bot-Thread\n\n_Exportiert am ${new Date().toLocaleString("de")}_\n` +
					this.transkript.join("\n\n") +
					"\n";
				const ziel = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(join(
						vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
						"syntax-bot-thread.md",
					)),
					filters: { Markdown: ["md"] },
				});
				if (ziel) {
					writeFileSync(ziel.fsPath, inhalt);
					void this.webview.postMessage({
						type: "status",
						text: `Thread gespeichert: ${ziel.fsPath}`,
					});
				}
				break;
			}
			case "stop": {
				if (!this.sessionId) return;
				this.client.benachrichtigen("session/cancel", { sessionId: this.sessionId });
				// Sicherheitsnetz: Falls das Abort-Ereignis den Prompt nie
				// zurückkehren lässt, gibt die UI spätestens nach 2 s wieder frei.
				setTimeout(() => {
					if (this.laufend) {
						this.laufend = false;
						this.sende({ type: "turnEnd" });
						this.sende({ type: "status", text: "Abgebrochen." });
					}
				}, 2_000);
				break;
			}
			case "mode": {
				if (!this.sessionId) return;
				try {
					await this.client.anfragen("session/set_mode", {
						sessionId: this.sessionId,
						modeId: String(nachricht.id ?? ""),
					});
					this.aktuellerModus = String(nachricht.id ?? "");
					this.sende({ type: "modeChanged", currentModeId: this.aktuellerModus });
				} catch (fehler) {
					this.sende({
						type: "error",
						text: fehler instanceof Error ? fehler.message : String(fehler),
					});
				}
				break;
			}
			case "setModel": {
				if (!this.sessionId) return;
				try {
					await this.client.anfragen("session/set_model", {
						sessionId: this.sessionId,
						modelId: String(nachricht.id ?? ""),
					});
				} catch (fehler) {
					this.sende({
						type: "error",
						text: fehler instanceof Error ? fehler.message : String(fehler),
					});
				}
				await this.statusNachreichen();
				break;
			}
			case "setThinking": {
				if (!this.sessionId) return;
				try {
					await this.client.anfragen("session/set_thinking", {
						sessionId: this.sessionId,
						level: String(nachricht.level ?? ""),
					});
				} catch (fehler) {
					this.sende({
						type: "error",
						text: fehler instanceof Error ? fehler.message : String(fehler),
					});
				}
				await this.statusNachreichen();
				break;
			}
			case "permission": {
				const erledigen = this.berechtigungOffen;
				this.berechtigungOffen = undefined;
				const wahl = String(nachricht.optionId ?? "");
				erledigen?.({
					outcome: wahl === "ja" ? { outcome: "selected", optionId: "ja" } : { outcome: "cancelled" },
				});
				break;
			}
			case "threads": {
				// Chat-Verlauf: frühere Threads dieses Arbeitsbereichs auflisten.
				if (!this.sessionId) return;
				try {
					const antwort = (await this.client.anfragen("syntax-bot/threads", {
						sessionId: this.sessionId,
					})) as { threads?: unknown[] };
					this.sende({ type: "threads", threads: antwort.threads ?? [] });
				} catch (fehler) {
					this.sende({ type: "error", text: fehler instanceof Error ? fehler.message : String(fehler) });
				}
				break;
			}
			case "openThread": {
				// Alten Thread fortsetzen: Laufendes abbrechen, dann per Pfad laden.
				const pfad = String(nachricht.pfad ?? "");
				if (!pfad || !this.sessionId) return;
				this.client.benachrichtigen("session/cancel", { sessionId: this.sessionId });
				this.laufend = false;
				try {
					const antwort = (await this.client.anfragen("session/load", {
						sessionId: this.sessionId,
						path: pfad,
					})) as { _meta?: { verlauf?: Array<{ rolle: string; text: string }> } };
					this.transkript = [];
					this.assistentEntwurf = undefined;
					this.nutzerImZug = false;
					this.sende({ type: "threadGeladen", verlauf: antwort._meta?.verlauf ?? [] });
					await this.zustandSenden();
				} catch (fehler) {
					this.sende({ type: "error", text: fehler instanceof Error ? fehler.message : String(fehler) });
				}
				break;
			}
			case "newThread": {
				// Neuer Thread: offene Prozesse (z. B. Anmeldung) abbrechen und
				// den Kontext leeren — jeder Thread bekommt seinen eigenen.
				if (!this.sessionId) return;
				this.client.benachrichtigen("session/cancel", { sessionId: this.sessionId });
				this.laufend = false;
				this.transkript = [];
				this.assistentEntwurf = undefined;
				this.nutzerImZug = false;
				this.sende({ type: "threadNeu" });
				try {
					await this.client.anfragen("session/prompt", {
						sessionId: this.sessionId,
						prompt: [{ type: "text", text: "/new" }],
					});
				} catch (fehler) {
					this.sende({ type: "error", text: fehler instanceof Error ? fehler.message : String(fehler) });
				}
				await this.zustandSenden();
				break;
			}
			case "openLink": {
				// Klickbarer Link aus dem Chat (z. B. Browser-Anmeldung) — im
				// System-Browser öffnen, ohne Kopieren/Einfügen.
				const url = String(nachricht.url ?? "");
				if (/^https?:\/\//i.test(url)) void vscode.env.openExternal(vscode.Uri.parse(url));
				break;
			}
		}
	}
}

/**
 * Richtet das Konfigurations-Home im globalStorage ein und trägt die mit der
 * VSIX gelieferten Pi-Extensions ein (entspricht ensurePackageRegistered aus
 * scripts/bootstrap.mjs — nur eben ohne Repo auf Platte).
 */
function agentDirVorbereiten(context: vscode.ExtensionContext): string {
	const agentDir = join(context.globalStorageUri.fsPath, "agent");
	mkdirSync(agentDir, { recursive: true });

	const settingsPfad = join(agentDir, "settings.json");
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(readFileSync(settingsPfad, "utf8")) as Record<string, unknown>;
	} catch {
		settings = {};
	}
	const paketPfad = join(context.extensionPath, "dist", "pi-package");
	const pakete = Array.isArray(settings.packages) ? settings.packages : [];
	const eingetragen = pakete.some((eintrag) => {
		const quelle = typeof eintrag === "string" ? eintrag : (eintrag as { source?: string })?.source;
		return quelle === paketPfad;
	});
	if (!eingetragen) {
		settings.packages = [...pakete, paketPfad];
		writeFileSync(settingsPfad, `${JSON.stringify(settings, null, 2)}\n`);
	}
	return agentDir;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
	private sitzung?: ChatSitzung;
	private readonly protokoll = vscode.window.createOutputChannel("Syntax Bot", { log: true });

	constructor(
		private readonly context: vscode.ExtensionContext,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = { enableScripts: true };

		// Bewusst alles eingebettet: Externe Webview-Ressourcen (CSS/JS/Schriften
		// über asWebviewUri) bleiben je nach VS-Code-Build hinter der CSP hängen.
		// Eingebettet funktioniert es überall — die Dateien sind klein genug.
		const css = this.media("chat.css").replace(
			/url\("\.\/fonts\/([^"]+)"\)/g,
			(_m, datei: string) => `url("${this.schriftUri(datei)}")`,
		);
		const js = this.media("chat.js");
		view.webview.html = chatHtml(css, js);

		const agentDir = agentDirVorbereiten(this.context);
		// Ohne geöffneten Ordner NICHT das Home-Verzeichnis nehmen — Pi würde
		// dort womöglich riesige Bereiche durchsuchen. Stattdessen fester
		// Wegwerf-Arbeitsbereich unter dem Extension-Speicher.
		const arbeitsbereich =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
			join(this.context.globalStorageUri.fsPath, "workspaces", "standard");
		mkdirSync(arbeitsbereich, { recursive: true });
		this.protokoll.info(`Starte Session (agentDir=${agentDir}, cwd=${arbeitsbereich}) …`);

		this.sitzung?.dispose();
		const sitzung = new ChatSitzung(view.webview, agentDir, arbeitsbereich, (text) =>
			this.protokoll.info(text),
		);
		this.sitzung = sitzung;

		view.webview.onDidReceiveMessage((nachricht) => {
			const daten = (typeof nachricht === "string" ? safeParse(nachricht) : nachricht) as Record<string, unknown>;
			if (!daten) return;
			this.protokoll.info(`← Webview: ${JSON.stringify(daten).slice(0, 140)}`);
			if (daten.type === "log") {
				this.protokoll.info(String(daten.text ?? ""));
				return;
			}
			if (daten.type === "error") {
				this.protokoll.error(String(daten.text ?? ""));
			}
			if (daten.type === "log" && daten.text === "pong") {
				this.diagnose("PONG erhalten — Host→Webview-Zustellung funktioniert.");
			}
			if (daten.type === "poll") {
				this.pollBeantworten(Number(daten.ab ?? 0));
				return;
			}
			void sitzung.nachricht(daten);
		});
		view.onDidDispose(() => {
			sitzung.dispose();
			if (this.sitzung === sitzung) this.sitzung = undefined;
		});

		void sitzung.starten().catch((fehler: unknown) => {
			const text = `Syntax Bot konnte nicht starten: ${fehler instanceof Error ? fehler.stack : String(fehler)}`;
			this.protokoll.error(text);
			void view.webview.postMessage({ type: "error", text });
		});
	}
	private media(name: string): string {
		return readFileSync(join(this.context.extensionPath, "media", name), "utf8");
	}

	/** Diagnosezeilen direkt auf Platte — für automatisierte Tests lesbar. */
	private diagnose(text: string): void {
		this.protokoll.info(`[diagnose] ${text}`);
		try {
			appendFileSync(join(this.context.globalStorageUri.fsPath, "diagnose.log"), `${new Date().toISOString()} ${text}\n`);
		} catch {
			/* Diagnose darf nie knallen. */
		}
	}

	/** Schrift als data-URI einbetten (siehe resolveWebviewView). */
	private schriftUri(name: string): string {
		const daten = readFileSync(join(this.context.extensionPath, "media", "fonts", name));
		return `data:font/woff2;base64,${daten.toString("base64")}`;
	}

	/** Neuer Thread über die Befehlspalette — bricht Laufendes ab, leert den Kontext. */
	neuerThread(): void {
		void this.sitzung?.nachricht({ type: "newThread" });
	}
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function chatHtml(css: string, js: string): string {
	// Bewusst OHNE CSP-Meta und mit komplett eingebetteten Inhalten (CSS, JS,
	// Schriften als data-URI): keine externen Ressourcen, keine CSP-Fallen.
	const skript = js.replace(/<\/script/gi, "<\\/script");
	return /* html */ `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>${css}</style>
<title>Syntax Bot</title>
</head>
<body>
<header class="kopf">
	<div class="marke">SYNTAX·BOT</div>
	<div class="kopfAktionen">
		<button id="neu" class="kopfKnopf" title="Neuer Thread (/new)">＋</button>
		<button id="punkte" class="kopfKnopf" title="Menü">⋯</button>
	</div>
</header>
<main class="verlauf" id="verlauf" aria-live="polite"></main>
<div class="dialogBerechtigungen" id="berechtigungen"></div>
<footer class="fussLeiste">
	<textarea id="eingabe" rows="2" placeholder="Nachricht — / für Commands"></textarea>
	<div class="fussWerkzeug">
		<button id="anhang" class="fussKnopf" title="Datei als Kontext einfügen (@pfad)">+</button>
		<span class="fussAbstand"></span>
		<span id="kontext" class="fussInfo" title="Kontext-Füllstand">—</span>
		<button id="modellKnopf" class="fussKnopf" title="Modell wählen"><span class="etikett">Modell</span></button>
		<button id="thinkingKnopf" class="fussKnopf" title="Thinking-Stufe"><span class="etikett">Think</span></button>
		<button id="modusKnopf" class="fussKnopf" title="Modus wählen"><span class="etikett">Modus</span></button>
		<button id="senden" class="fussKnopf senden" title="Senden">➤</button>
	</div>
</footer>
<div id="menue" class="menue" hidden></div>
<script>${skript}</script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new ChatViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("syntaxBot.chat", provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand("syntaxBot.open", async () => {
			await vscode.commands.executeCommand("syntaxBot.chat.focus");
		}),
		vscode.commands.registerCommand("syntaxBot.newSession", () => {
			provider.neuerThread();
		}),
	);
}

export function deactivate(): void {}
