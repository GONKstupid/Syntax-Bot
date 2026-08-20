/**
 * BYOM — „bring your own model".
 *
 * Nutzer hinterlegen einen OpenAI-kompatiblen Endpunkt (eigener API-Key,
 * Ollama, LM Studio, llama.cpp …) über den Einstellungsdialog. Der Server
 * registriert den Provider auf dem ModelRuntime der Session und setzt das
 * gewählte Modell.
 *
 * Sicherheit: API-Schlüssel liegen ausschließlich im Arbeitsspeicher —
 * sie werden nie persistiert und nie geloggt. Nach einem Server-Neustart
 * geben Nutzer ihre Verbindung erneut ein.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Vom Nutzer eingegebene Provider-Konfiguration. */
export interface ByomConfig {
	/** Interne Provider-Kennung (Slug), z. B. „mein-ollama". */
	providerId: string;
	/** Anzeigename für die Oberfläche. */
	displayName: string;
	/** OpenAI-kompatibler Endpunkt, z. B. http://localhost:11434/v1. */
	baseUrl: string;
	/** Darf leer sein — lokale Endpunkte brauchen oft keinen Schlüssel. */
	apiKey: string;
	/** Modell-ID, z. B. „llama3.1:8b". */
	modelId: string;
}

/** Strukturkompatibel zu ProviderConfigInput des SDK (bewusst ohne Import). */
interface ProviderRegistration {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	models?: Array<{
		id: string;
		name: string;
		api?: string;
		reasoning: boolean;
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
	}>;
}

/** Konservativer Standard, falls das Kontextfenster unbekannt ist. */
const STANDARD_KONTEXTFENSTER = 32768;
const STANDARD_MAX_TOKENS = 4096;

/** Prüft die Nutzereingaben und liefert eine normalisierte Konfiguration. */
export function validateByomConfig(raw: unknown): ByomConfig {
	const eingabe = (raw ?? {}) as Record<string, unknown>;
	const baseUrl = typeof eingabe.baseUrl === "string" ? eingabe.baseUrl.trim().replace(/\/+$/, "") : "";
	const modelId = typeof eingabe.modelId === "string" ? eingabe.modelId.trim() : "";
	const apiKey = typeof eingabe.apiKey === "string" ? eingabe.apiKey.trim() : "";
	const displayName = typeof eingabe.displayName === "string" ? eingabe.displayName.trim() : "";

	if (!baseUrl) throw new Error("Bitte eine Endpunkt-URL angeben (z. B. http://localhost:11434/v1).");
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new Error("Die Endpunkt-URL ist ungültig.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Die Endpunkt-URL muss mit http:// oder https:// beginnen.");
	}
	if (!modelId) throw new Error("Bitte eine Modell-ID angeben.");

	const basis = displayName || url.host;
	const providerId =
		"byom-" +
		basis
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) ||
		"anbieter";

	return { providerId, displayName: basis, baseUrl, apiKey, modelId };
}

/**
 * Verbindungstest: fragt die Modell-Liste des Endpunkts ab.
 * Versteht das OpenAI-Format ({ data: [{ id }] }) und das Ollama-Format
 * ({ models: [{ name }] }).
 */
export async function fetchRemoteModels(baseUrl: string, apiKey: string): Promise<string[]> {
	const basis = baseUrl.replace(/\/+$/, "");
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;

	const kandidaten = basis.endsWith("/v1") ? [`${basis}/models`] : [`${basis}/v1/models`, `${basis}/models`];
	let letzterFehler: Error | null = null;

	for (const kandidat of kandidaten) {
		try {
			const antwort = await fetch(kandidat, { headers, signal: AbortSignal.timeout(8000) });
			if (!antwort.ok) {
				letzterFehler = new Error(`HTTP ${antwort.status} bei ${kandidat}`);
				continue;
			}
			const daten = (await antwort.json()) as {
				data?: Array<{ id?: string; name?: string }>;
				models?: Array<{ id?: string; name?: string }>;
			};
			const ids = (daten.data ?? daten.models ?? [])
				.map((eintrag) => eintrag.id ?? eintrag.name)
				.filter((id): id is string => typeof id === "string" && id.length > 0);
			if (ids.length > 0) return ids;
			letzterFehler = new Error(`Keine Modelle in der Antwort von ${kandidat}`);
		} catch (fehler) {
			letzterFehler = fehler instanceof Error ? fehler : new Error(String(fehler));
		}
	}

	throw new Error(
		letzterFehler
			? `Der Endpunkt lieferte keine Modell-Liste (${letzterFehler.message}).`
			: "Der Endpunkt lieferte keine Modell-Liste.",
	);
}

/** Registriert den Provider auf der Session und setzt das gewählte Modell. */
export async function applyByomToSession(session: AgentSession, config: ByomConfig): Promise<void> {
	const registration: ProviderRegistration = {
		name: config.displayName,
		baseUrl: config.baseUrl,
		api: "openai-completions",
		models: [
			{
				id: config.modelId,
				name: config.modelId,
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: STANDARD_KONTEXTFENSTER,
				maxTokens: STANDARD_MAX_TOKENS,
			},
		],
	};
	if (config.apiKey) registration.apiKey = config.apiKey;

	session.modelRuntime.registerProvider(config.providerId, registration);

	const verfuegbare = await session.modelRuntime.getAvailable(config.providerId);
	const modell = verfuegbare.find((kandidat) => kandidat.id === config.modelId) ?? verfuegbare[0];
	if (!modell) throw new Error("Der Provider wurde registriert, liefert aber kein Modell.");
	await session.setModel(modell);
}
