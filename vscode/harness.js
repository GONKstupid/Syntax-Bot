/**
 * Automatisierter Test im echten VS Code: öffnet das Syntax-Bot-Panel und
 * wartet, damit die Ping/Pong-Runde über den Webview-Kanal laufen kann.
 * Das Ergebnis steht danach in globalStorage/syntax-bot.syntax-bot/diagnose.log.
 */

const vscode = require("vscode");

async function run() {
	await vscode.commands.executeCommand("syntaxBot.chat.focus");
	await new Promise((r) => setTimeout(r, 8000));
	return;
}

module.exports = { run };
