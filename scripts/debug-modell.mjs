#!/usr/bin/env node
/**
 * DEBUG: Erzeugt eine Pi-Session gegen ein agentDir und sendet einen
 * Test-Prompt — meldet alle Ereignisse, um stumme Modellaufrufe zu finden.
 *
 *   node scripts/debug-modell.mjs [agentDir] ["Prompt"]
 */

import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const agentDir = process.argv[2] ?? "C:\\Users\\gonk\\AppData\\Roaming\\Code\\User\\globalStorage\\syntax-bot.syntax-bot\\agent";
const promptText = process.argv[3] ?? "Antworte bitte mit genau einem Wort: Test.";

const cwd = process.cwd();
const loader = new DefaultResourceLoader({ cwd, agentDir });
await loader.reload();
const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader });

console.error(`Modell: ${session.model ? `${session.model.provider}:${session.model.id}` : "KEINS"}`);
console.error(`Thinking: ${typeof session.getThinkingLevel === "function" ? session.getThinkingLevel() : "?"}`);

	session.subscribe((ereignis) => {
		const typ = ereignis.type;
		if (typ.startsWith("message_")) {
			const message = ereignis.message ?? {};
			const inhalt = Array.isArray(message.content)
				? message.content.map((b) => `${b.type}:${String(b.text ?? "").length}`).join(", ")
				: "?";
			console.error(`[ereignis] ${typ} role=${message.role} stopReason=${message.stopReason ?? ""} content=[${inhalt}]`);
			if (message.stopReason === "error" || message.errorMessage) {
				console.error(`[details] ${JSON.stringify(message).slice(0, 600)}`);
			}
		} else if (typ === "tool_execution_start" || typ === "tool_execution_end") {
			console.error(`[ereignis] ${typ} ${ereignis.toolName}`);
		} else {
			console.error(`[ereignis] ${typ}`);
		}
	});

try {
	const ergebnis = await session.prompt(promptText);
	console.error(`[fertig] stopReason=${JSON.stringify(ergebnis)}`);
} catch (fehler) {
	console.error(`[FEHLER] ${fehler instanceof Error ? fehler.stack : String(fehler)}`);
}
session.dispose?.();
process.exit(0);
