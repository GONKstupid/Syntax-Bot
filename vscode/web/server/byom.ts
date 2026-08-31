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

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
		/** Kompatibilitäts-Schalter für OpenAI-kompatible Endpunkte. */
		compat?: { supportsFinishReason?: boolean };
	}>;
}

/** Konservativer Standard, falls das Kontextfenster unbekannt ist. */
const STANDARD_KONTEXTFENSTER = 32768;
const STANDARD_MAX_TOKENS = 4096;

/**
 * SSRF-Schutz: Der Server fragt Nutzern angegebene Endpunkte selbst ab —
 * ohne Prüfung könnte jemand interne Dienste oder Cloud-Metadaten-Adressen
 * erreichen (siehe HANDOFF, Risiken).
 *
 * Immer blockiert: Link-local/Metadaten (169.254.0.0/16), Unspezifiziert
 * (0.0.0.0, ::), Multicast und Reserviertes.
 * Erlaubt bleiben standardmäßig Loopback und RFC1918 — lokale Modelle
 * (Ollama auf 127.0.0.1) sind das Kernfeature. Mit SYNTAX_BOT_BYOM_STRICT=1
 * werden auch diese abgelehnt (für öffentlich betriebene Server).
 */

function istPrivaterHost(host: string): boolean {
	const hostKlein = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (hostKlein === "localhost" || hostKlein.endsWith(".localhost") || hostKlein.endsWith(".local")) return true;

	if (isIP(hostKlein) === 4) {
		const teile = hostKlein.split(".").map(Number);
		const [a, b] = teile;
		if (a === 127 || a === 10 || a === 0) return true;
		if (a === 169 && b === 254) return true; // Link-local inkl. Metadaten-IP
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT-Reserve
		return false;
	}
	if (isIP(hostKlein) === 6) {
		const normalisiert = hostKlein.replace(/^::ffff:/i, "").toLowerCase();
		if (normalisiert.includes(":") === false && isIP(normalisiert) === 4) {
			return istPrivaterHost(normalisiert); // IPv4-gemappt (::ffff:127.0.0.1 …)
		}
		if (hostKlein === "::" || hostKlein === "::1") return true;
		if (hostKlein.startsWith("fe80:")) return true; // Link-local
		if (/^f[cd][0-9a-f]{2}:/.test(hostKlein)) return true; // Unique Local fc00::/7
		if (hostKlein.startsWith("ff")) return true; // Multicast
		return false;
	}
	return false; // Hostname — wird nach DNS-Auflösung geprüft.
}

/**
 * Prüft eine Endpunkt-URL gegen die Blockliste. Hostnamen werden dabei
 * aufgelöst und jede Antwortadresse geprüft — ein Eintrag im DNS, der ins
 * interne Netz zeigt, wird so erkannt. Löst bei Verstoß mit deutscher
 * Fehlermeldung aus.
 */
export async function pruefeEndpunkt(baseUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new Error("Die Endpunkt-URL ist ungültig.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Die Endpunkt-URL muss mit http:// oder https:// beginnen.");
	}

	const streng = process.env.SYNTAX_BOT_BYOM_STRICT === "1";
	const host = url.hostname;
	const hostIstIp = isIP(host.replace(/^\[|\]$/g, "")) !== 0;

	if (hostIstIp) {
		if (istGefahrlicheAdresse(host)) {
			throw new Error(
				`Der Endpunkt „${host}“ ist nicht erlaubt (Metadaten-/Link-local-/Reserve-Bereiche sind blockiert).`,
			);
		}
		if (streng && istPrivaterHost(host)) {
			throw new Error(
				`Der Endpunkt „${host}“ liegt in einem privaten Adressbereich — bei SYNTAX_BOT_BYOM_STRICT=1 nicht erlaubt.`,
			);
		}
		return;
	}

	// Hostname: erst auflösen, dann jede Adresse einzeln bewerten.
	if (isIP(host) === 0) {
		let adressen: string[];
		try {
			adressen = (await lookup(host, { all: true })).map((eintrag) => eintrag.address);
		} catch {
			throw new Error(`Der Hostname „${host}“ konnte nicht aufgelöst werden.`);
		}
		for (const adresse of adressen) {
			if (streng ? istPrivaterHost(adresse) : istGefahrlicheAdresse(adresse)) {
				throw new Error(
					`„${host}“ löst zu ${adresse} auf — dieser Adressbereich ist nicht erlaubt.`,
				);
			}
		}
	}
}

/** Auch im Standardmodus verboten: Metadaten/Link-local/Unspezifiziert/Multicast. */
function istGefahrlicheAdresse(adresse: string): boolean {
	const klein = adresse.toLowerCase().replace(/^\[|\]$/g, "");
	if (isIP(klein) === 4) {
		const [a, b] = klein.split(".").map(Number);
		return a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a >= 224;
	}
	const normalisiert = klein.replace(/^\[|\]$/g, "");
	if (normalisiert.startsWith("::ffff:")) {
		// IPv4-gemappt — in zwei Formen: „::ffff:192.0.2.1" und „::ffff:c000:201".
		const rest = normalisiert.slice(7);
		if (isIP(rest) === 4) return istGefahrlicheAdresse(rest);
		const teile = rest.split(":").map((gruppe) => parseInt(gruppe, 16));
		if (teile.length === 2 && teile.every((z) => Number.isFinite(z))) {
			return istGefahrlicheAdresse(`${(teile[0] >> 8) & 255}.${teile[0] & 255}.${(teile[1] >> 8) & 255}.${teile[1] & 255}`);
		}
	}
	return normalisiert === "::" || normalisiert.startsWith("fe80:") || normalisiert.startsWith("ff");
}

/** Prüft die Nutzereingaben und liefert eine normalisierte Konfiguration. */
export async function validateByomConfig(raw: unknown): Promise<ByomConfig> {
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
	await pruefeEndpunkt(baseUrl);

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
	await pruefeEndpunkt(baseUrl);
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
				// Freie Endpunkte (LM Studio, Ollama, llama.cpp …) liefern nicht
				// immer ein finish_reason im letzten Chunk — ohne diesen Schalter
				// wirft Pi „Stream ended without finish_reason". Mit dem Schalter
				// wird ein fehlendes finish_reason als „stop"/„toolUse" gedeutet;
				// ein vorhandenes wird weiterhin normal ausgewertet.
				compat: { supportsFinishReason: false },
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
