/**
 * Regeln dafür, was ein Modus über das bash-Werkzeug ausführen darf.
 *
 * Hintergrund: `setActiveTools` blendet ein Werkzeug komplett aus — das ist zu
 * grob für Cleanup, denn dort sollen Formatter und Linter laufen dürfen, sonst
 * aber nichts. Deshalb gibt es zusätzlich diese Allowlist, die vor der
 * Ausführung jedes einzelnen Kommandos greift.
 */

export type BashPolicy =
	/** bash ist in diesem Modus gesperrt. */
	| { kind: "blocked" }
	/** bash ist uneingeschränkt nutzbar. */
	| { kind: "unrestricted" }
	/** Nur Kommandos, die auf eines der Muster passen. */
	| { kind: "allowlist"; label: string; patterns: RegExp[] };

/** Zeichen, die eine Kommando-Kette oder eine Umleitung einleiten. */
const CHAIN_SEPARATORS = ["&&", "||", ";", "|", "\n"];

/**
 * Konstrukte, die eine Allowlist aushebeln würden: Umleitungen schreiben an
 * beliebige Pfade, Substitutionen schmuggeln ein zweites Kommando ein.
 */
const SMUGGLING_PATTERNS = [/>/, /`/, /\$\(/, /<\(/];

/** Zerlegt eine Kommandozeile in Einzelkommandos, ohne in Anführungszeichen zu trennen. */
export function splitCommandChain(command: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;

	for (let i = 0; i < command.length; i++) {
		const char = command[i] as string;

		if (quote) {
			current += char;
			if (char === quote && command[i - 1] !== "\\") quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}

		const separator = CHAIN_SEPARATORS.find((sep) => command.startsWith(sep, i));
		if (separator) {
			parts.push(current);
			current = "";
			i += separator.length - 1;
			continue;
		}
		current += char;
	}
	parts.push(current);

	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export interface BashPolicyResult {
	allowed: boolean;
	/** Begründung für die Sperre, direkt für Nutzer und Modell verwendbar. */
	reason?: string;
}

/** Prüft ein komplettes bash-Kommando gegen die Regeln eines Modus. */
export function checkBashPolicy(policy: BashPolicy, command: string): BashPolicyResult {
	if (policy.kind === "unrestricted") return { allowed: true };
	if (policy.kind === "blocked") {
		return { allowed: false, reason: "In diesem Modus ist das Ausführen von Shell-Kommandos gesperrt." };
	}

	const smuggled = SMUGGLING_PATTERNS.find((pattern) => pattern.test(command));
	if (smuggled) {
		return {
			allowed: false,
			reason:
				"Umleitungen und Kommando-Substitutionen (>, `…`, $(…), <(…)) sind hier gesperrt, " +
				"weil sie die Allowlist umgehen könnten. Formatter dürfen die Datei direkt ändern.",
		};
	}

	for (const part of splitCommandChain(command)) {
		if (!policy.patterns.some((pattern) => pattern.test(part))) {
			return {
				allowed: false,
				reason: `"${part}" steht nicht auf der Allowlist (${policy.label}).`,
			};
		}
	}

	return { allowed: true };
}

/**
 * Formatter, Linter und rein lesende Kommandos — alles, was der Cleanup-Modus
 * braucht, um Struktur zu bereinigen, ohne Logik ausführen zu können.
 */
export const FORMATTER_ALLOWLIST: RegExp[] = [
	// Web / JS / TS
	/^(npx\s+(--no-install\s+)?)?prettier\b/,
	/^(npx\s+(--no-install\s+)?)?eslint\b/,
	/^(npx\s+(--no-install\s+)?)?biome\b/,
	/^(npx\s+(--no-install\s+)?)?dprint\b/,
	// C / C++ / Java / Kotlin / Swift
	/^clang-format\b/,
	/^astyle\b/,
	/^uncrustify\b/,
	/^indent\b/,
	/^google-java-format\b/,
	/^ktlint\b/,
	/^swiftformat\b/,
	// Python
	/^(python3?\s+-m\s+)?black\b/,
	/^(python3?\s+-m\s+)?ruff\b/,
	/^(python3?\s+-m\s+)?isort\b/,
	/^(python3?\s+-m\s+)?autopep8\b/,
	// Go / Rust / .NET / PHP / Lua / Shell
	/^gofmt\b/,
	/^goimports\b/,
	/^rustfmt\b/,
	/^cargo\s+fmt\b/,
	/^dotnet\s+format\b/,
	/^php-cs-fixer\b/,
	/^stylua\b/,
	/^shfmt\b/,
	/^taplo\b/,
	// Nur lesende Kontrolle des Ergebnisses
	/^git\s+(diff|status|show)\b/,
	/^diff\b/,
	/^wc\b/,
];
