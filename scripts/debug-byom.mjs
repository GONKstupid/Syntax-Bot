#!/usr/bin/env node
/**
 * DEBUG: Registriert einen BYOM-Provider (LM Studio) auf einem ModelRuntime
 * und prüft, wann getAvailable() die Modelle liefert.
 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const baseUrl = process.argv[2] ?? "http://localhost:1234/v1";
const modellId = process.argv[3] ?? "google/gemma-4-e4b";

const rt = await ModelRuntime.create({
	authPath: undefined,
	modelsPath: null,
	refreshOnCreate: false,
});

function registrieren(apiKey) {
	rt.registerProvider("sb-debug", {
		name: "LM Studio (Debug)",
		baseUrl,
		api: "openai-completions",
		...(apiKey ? { apiKey } : {}),
		models: [
			{
				id: modellId,
				name: modellId,
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 4096,
			},
		],
	});
}

console.error("--- ohne apiKey ---");
registrieren(undefined);
console.error(`authStatus: ${JSON.stringify(rt.getProviderAuthStatus("sb-debug"))}`);
console.error(`getAvailable(provider): ${(await rt.getAvailable("sb-debug")).length}`);
console.error(`getAvailable(): ${(await rt.getAvailable()).length}`);

console.error("--- mit Dummy-apiKey ---");
rt.unregisterProvider("sb-debug");
registrieren("sk-dummy");
console.error(`authStatus: ${JSON.stringify(rt.getProviderAuthStatus("sb-debug"))}`);
console.error(`getAvailable(provider): ${(await rt.getAvailable("sb-debug")).length}`);
console.error(`getAvailable(): ${(await rt.getAvailable()).length}`);
console.error(`snapshot: ${rt.getAvailableSnapshot().filter((m) => m.provider === "sb-debug").length}`);
process.exit(0);
