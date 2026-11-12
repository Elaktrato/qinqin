// The session setup is a small choice the user makes before studying:
// which decks to draw from, how many new and review cards to include,
// and which card kinds to queue. It is per-tab state, so it lives in
// sessionStorage rather than the server: no sync, no stale setup on the
// next device.

/**
 * How a session picks its cards: from user decks, or from one level of a
 * level scheme. The unused mode's fields are kept (and ignored) so a
 * user can switch back without losing their deck selection.
 */
export type StudySessionMode = 'decks' | 'levels';

/**
 * One session setup. `deckIds` may name decks that no longer exist; the
 * page filters those against the loaded study data before starting.
 * `schemeId` and `levelName` identify the level scheme in levels mode.
 */
export interface StudySessionConfig {
	mode: StudySessionMode;
	schemeId: number | null;
	levelName: string | null;
	deckIds: string[];
	newLimit: number;
	reviewLimit: number;
	cardTypes: string[];
}

/** sessionStorage key of the setup. */
export const SESSION_CONFIG_KEY = 'qinqin.study.session';

/** Round 1 implements vocab only; the rest are reserved kinds. */
export const CARD_TYPES = [
	{ id: 'vocab', label: 'Vocab', available: true },
	{ id: 'sentence', label: 'Sentence', available: false },
	{ id: 'writing', label: 'Writing', available: false },
	{ id: 'tone', label: 'Tone', available: false }
] as const;

/** The one card kind a session can actually study today. */
export const IMPLEMENTED_CARD_TYPE = 'vocab';

/** The documented starting point: General deck, 20 new, 100 reviews. */
export const DEFAULT_CONFIG: StudySessionConfig = {
	mode: 'decks',
	schemeId: null,
	levelName: null,
	deckIds: ['general'],
	newLimit: 20,
	reviewLimit: 100,
	cardTypes: [IMPLEMENTED_CARD_TYPE]
};

// The server and the scheduler both treat limits as small counts; a
// four-digit limit is almost certainly a typo, not a study plan.
const MAX_LIMIT = 999;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPositiveLimit(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_LIMIT;
}

function isPositiveId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyName(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

/**
 * validateConfig returns one message per problem, empty when the setup
 * can start a session. Only vocab is implemented, so every session
 * must include it; the reserved kinds may be present but cannot replace
 * it. The active mode decides which source fields matter: decks mode
 * requires a deck and ignores scheme/level, while levels mode requires
 * a scheme and a level and ignores decks.
 */
export function validateConfig(config: StudySessionConfig): string[] {
	const errors: string[] = [];

	if (config.mode !== 'decks' && config.mode !== 'levels') {
		errors.push('Choose a session mode.');
	}

	if (config.mode === 'levels') {
		if (!isPositiveId(config.schemeId)) {
			errors.push('Select a scheme.');
		}
		if (!isNonEmptyName(config.levelName)) {
			errors.push('Select a level.');
		}
	} else if (
		config.mode === 'decks' &&
		(!Array.isArray(config.deckIds) || config.deckIds.length === 0)
	) {
		errors.push('Select at least one deck.');
	}

	if (!isPositiveLimit(config.newLimit)) {
		errors.push(`New card limit must be a whole number from 1 to ${MAX_LIMIT}.`);
	}

	if (!isPositiveLimit(config.reviewLimit)) {
		errors.push(`Review limit must be a whole number from 1 to ${MAX_LIMIT}.`);
	}

	if (
		!Array.isArray(config.cardTypes) ||
		!config.cardTypes.includes(IMPLEMENTED_CARD_TYPE)
	) {
		errors.push('Vocab cards must be included.');
	}

	return errors;
}

function storage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		// Access to the storage object itself can throw when blocked.
		return null;
	}
}

/**
 * parseConfig accepts only a complete, currently valid setup. A stored
 * setup from an older shape (or one that no longer validates) is
 * discarded rather than half-applied.
 */
function parseConfig(raw: string): StudySessionConfig | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (!isRecord(parsed)) return null;
	const { mode, schemeId, levelName, deckIds, newLimit, reviewLimit, cardTypes } = parsed;
	if (!isStringArray(deckIds) || !isStringArray(cardTypes)) return null;
	if (typeof newLimit !== 'number' || typeof reviewLimit !== 'number') return null;

	// Round 1 stored no mode; those setups were all deck sessions.
	const parsedMode = mode === undefined ? 'decks' : mode;
	if (parsedMode !== 'decks' && parsedMode !== 'levels') return null;

	const config: StudySessionConfig = {
		mode: parsedMode,
		schemeId: typeof schemeId === 'number' ? schemeId : null,
		levelName: typeof levelName === 'string' ? levelName : null,
		deckIds: [...deckIds],
		newLimit,
		reviewLimit,
		cardTypes: [...cardTypes]
	};
	return validateConfig(config).length === 0 ? config : null;
}

/**
 * loadConfig reads this tab's setup. Absent, malformed, or invalid
 * storage falls back to the defaults so the page always has a usable
 * starting state.
 */
export function loadConfig(): StudySessionConfig {
	const store = storage();
	if (store === null) return { ...DEFAULT_CONFIG };

	try {
		const raw = store.getItem(SESSION_CONFIG_KEY);
		if (raw === null) return { ...DEFAULT_CONFIG };
		const config = parseConfig(raw);
		return config ?? { ...DEFAULT_CONFIG };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

/**
 * saveConfig stores the setup for this tab. Storage being unavailable
 * is not an error: the start button still navigates with the in-memory
 * values for this visit.
 */
export function saveConfig(config: StudySessionConfig): void {
	const store = storage();
	if (store === null) return;

	try {
		store.setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
	} catch {
		// Private mode or a full quota: the session still starts.
	}
}
