/**
 * Einstieg für den IDE-Adapter: ACP über die echten Standard-Streams.
 *
 * Von Zed aus konfigurieren (settings.json):
 *
 *   "agent_servers": {
 *     "Syntax Bot": {
 *       "type": "custom",
 *       "command": "node",
 *       "args": ["<Pfad zu diesem Repo>\\ide\\index.ts"],
 *       "env": { "PI_CODING_AGENT_DIR": "<Home>\\.syntax-bot\\agent" }
 *     }
 *   }
 *
 * Der Pfad zur isolierten Instanz wird wie überall aus SYNTAX_BOT_HOME
 * (Standard ~/.syntax-bot) abgeleitet — einmal `scripts/syntax-bot.ps1`
 * bzw. `.sh` ausgeführt genügt, danach kennt Zed Syntax Bot.
 */

import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { AcpVerbindung } from "./acp.ts";
import { AcpAdapter } from "./adapter.ts";

const home = process.env.SYNTAX_BOT_HOME || join(homedir(), ".syntax-bot");
const agentDir = process.env.PI_CODING_AGENT_DIR || join(home, "agent");

if (!existsSync(agentDir)) {
	process.stderr.write(
		`Syntax Bot: isolierte Instanz fehlt (${agentDir}).\n` +
			"Bitte zuerst „scripts/syntax-bot.ps1“ bzw. „scripts/syntax-bot.sh“ starten.\n",
	);
	process.exit(1);
}

const adapter = new AcpAdapter({ agentDir });
const verbindung = new AcpVerbindung(
	(zeile) => process.stdout.write(`${zeile}\n`),
	(anfrage) => adapter.anfrage(verbindung, anfrage),
	(benachrichtigung) => adapter.benachrichtigung(benachrichtigung),
);

const zeilen = createInterface({ input: process.stdin, terminal: false });
zeilen.on("line", (zeile) => {
	const getrimmt = zeile.trim();
	if (getrimmt) verbindung.daten(`${getrimmt}\n`);
});
zeilen.on("close", () => {
	adapter.schliessen();
	verbindung.schliessen();
	process.exit(0);
});

process.on("SIGINT", () => {
	adapter.schliessen();
	verbindung.schliessen();
	process.exit(0);
});
