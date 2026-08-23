/**
 * ACP-Framing — JSON-RPC 2.0 über zeilengetrennten stdio.
 *
 * Der Agent Client Protocol (https://agentclientprotocol.com) schickt jede
 * Nachricht als eine Zeile JSON. Diese Schicht kennt nur das Framing und die
 * Weiterleitung: Anfragen bekommen ein Promise, Benachrichtigungen landen im
 * Handler. Bewusst ohne Abhängigkeiten — das Protokoll ist klein, und wir
 * wollen es in Tests mit Speicher-Streams treiben können.
 */

export interface RpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

export interface RpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

type RpcMessage = RpcRequest | RpcNotification | { jsonrpc: "2.0"; id: number | string; result?: unknown; error?: unknown };

interface Ausstehend {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

export class AcpVerbindung {
	private readonly puffer = new Map<number | string, Ausstehend>();
	private naechsteId = 1;
	private eingabeRest = "";
	private geschlossen = false;

	private readonly ausgabe: (zeile: string) => void;
	private readonly empfangsanfrage: (anfrage: RpcRequest) => Promise<unknown>;
	private readonly empfangsbenachrichtigung: (nachricht: RpcNotification) => void;

	constructor(
		ausgabe: (zeile: string) => void,
		empfangsanfrage: (anfrage: RpcRequest) => Promise<unknown>,
		empfangsbenachrichtigung: (nachricht: RpcNotification) => void,
	) {
		this.ausgabe = ausgabe;
		this.empfangsanfrage = empfangsanfrage;
		this.empfangsbenachrichtigung = empfangsbenachrichtigung;
	}

	/** Eingehende Rohdaten verarbeiten (kann mitten in einer Zeile ankommen). */
	daten(daten: string): void {
		this.eingabeRest += daten;
		let umbruch = this.eingabeRest.indexOf("\n");
		while (umbruch !== -1) {
			const zeile = this.eingabeRest.slice(0, umbruch).trim();
			this.eingabeRest = this.eingabeRest.slice(umbruch + 1);
			if (zeile) this.zeile(zeile);
			umbruch = this.eingabeRest.indexOf("\n");
		}
	}

	private zeile(zeile: string): void {
		let nachricht: RpcMessage;
		try {
			nachricht = JSON.parse(zeile) as RpcMessage;
		} catch {
			return; // Eine kaputte Zeile darf den Adapter nicht abreißen lassen.
		}
		if (!("method" in nachricht)) {
			// Antwort auf eine unserer eigenen Anfragen.
			const id = (nachricht as { id: number | string }).id;
			const wartend = this.puffer.get(id);
			if (!wartend) return;
			this.puffer.delete(id);
			if ((nachricht as { error?: { message?: string } }).error) {
				wartend.reject(new Error(`ACP-Fehler: ${JSON.stringify((nachricht as { error: unknown }).error)}`));
			} else {
				wartend.resolve((nachricht as { result?: unknown }).result);
			}
			return;
		}
		if ("id" in nachricht && nachricht.id !== undefined) {
			void this.anfrageBeantworten(nachricht as RpcRequest);
		} else {
			this.empfangsbenachrichtigung(nachricht as RpcNotification);
		}
	}

	private async anfrageBeantworten(anfrage: RpcRequest): Promise<void> {
		try {
			const ergebnis = await this.empfangsanfrage(anfrage);
			this.sende({ jsonrpc: "2.0", id: anfrage.id, result: ergebnis ?? {} });
		} catch (fehler) {
			this.sende({
				jsonrpc: "2.0",
				id: anfrage.id,
				error: {
					code: -32603,
					message: fehler instanceof Error ? fehler.message : String(fehler),
				},
			});
		}
	}

	/** Eigene Anfrage an die Gegenseite (z. B. session/request_permission). */
	anfragen(methode: string, params?: unknown): Promise<unknown> {
		if (this.geschlossen) return Promise.reject(new Error("Die ACP-Verbindung ist geschlossen."));
		const id = this.naechsteId++;
		return new Promise((resolvePromise, rejectPromise) => {
			this.puffer.set(id, { resolve: resolvePromise, reject: rejectPromise });
			this.sende({ jsonrpc: "2.0", id, method: methode, params });
		});
	}

	benachrichtigen(methode: string, params?: unknown): void {
		this.sende({ jsonrpc: "2.0", method: methode, params });
	}

	schliessen(): void {
		this.geschlossen = true;
		for (const wartend of this.puffer.values()) {
			wartend.reject(new Error("Die ACP-Verbindung wurde geschlossen."));
		}
		this.puffer.clear();
	}

	private sende(nachricht: Record<string, unknown>): void {
		this.ausgabe(JSON.stringify(nachricht));
	}
}
