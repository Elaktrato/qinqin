// The session setup is a small choice the user makes before studying:
// which decks to draw from, how many new and review cards to include,
// and which card kinds to queue. It is per-tab state, so it lives in
// sessionStorage rather than the server: no sync, no stale setup on the
// next device.

import { t } from '$lib/i18n';
import { parseNewOrder, type SessionNewOrder } from './newOrder';
import { CARD_KINDS } from './types';

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
	/**
	 * The order of new cards (#75). Absent = 'deck': the selected decks'
	 * own order (level order in a level session).
	 */
	newOrder?: SessionNewOrder;
}

/** sessionNewOrder is the setup's order of new cards, 'deck' by default. */
export function sessionNewOrder(config: StudySessionConfig): SessionNewOrder {
	return config.newOrder ?? 'deck';
}

/** sessionStorage key of the setup. */
export const SESSION_CONFIG_KEY = 'qinqin.study.session';

/** Every card kind a session can include. */
export const CARD_TYPES = [
	{ id: 'vocab', get label() { return t('study.cardType.vocab'); }, available: true },
	{ id: 'sentence', get label() { return t('study.cardType.sentence'); }, available: true },
	{ id: 'writing', get label() { return t('study.cardType.writing'); }, available: true },
	{ id: 'tone', get label() { return t('study.cardType.tone'); }, available: true },
	{ id: 'reverse', get label() { return t('study.cardType.reverse'); }, available: true },
	{ id: 'cloze', get label() { return t('study.cardType.cloze'); }, available: true }
] as const;

/** The documented starting point: General deck, 20 new, 100 reviews. */
export const DEFAULT_CONFIG: StudySessionConfig = {
	mode: 'decks',
	schemeId: null,
	levelName: null,
	deckIds: ['general'],
	newLimit: 20,
	reviewLimit: 100,
	cardTypes: ['vocab']
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
 * can start a session. At least one card type must be selected, every
 * selected type must be a known kind, and vocab is not mandatory. The
 * active mode decides which source fields matter: decks mode requires a
 * deck and ignores scheme/level, while levels mode requires a scheme and
 * a level and ignores decks.
 */
export function validateConfig(config: StudySessionConfig): string[] {
	const errors: string[] = [];

	if (config.mode !== 'decks' && config.mode !== 'levels') {
		errors.push(t('study.config.chooseMode'));
	}

	if (config.mode === 'levels') {
		if (!isPositiveId(config.schemeId)) {
			errors.push(t('study.config.selectScheme'));
		}
		if (!isNonEmptyName(config.levelName)) {
			errors.push(t('study.config.selectLevel'));
		}
	} else if (
		config.mode === 'decks' &&
		(!Array.isArray(config.deckIds) || config.deckIds.length === 0)
	) {
		errors.push(t('study.config.selectDeck'));
	}

	if (!isPositiveLimit(config.newLimit)) {
		errors.push(t('study.config.newLimit', { max: MAX_LIMIT }));
	}

	if (!isPositiveLimit(config.reviewLimit)) {
		errors.push(t('study.config.reviewLimit', { max: MAX_LIMIT }));
	}

	if (
		!Array.isArray(config.cardTypes) ||
		config.cardTypes.length === 0 ||
		!config.cardTypes.every((type) => (CARD_KINDS as readonly string[]).includes(type))
	) {
		errors.push(t('study.config.selectType'));
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
	const { mode, schemeId, levelName, deckIds, newLimit, reviewLimit, cardTypes, newOrder } = parsed;
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
	// A missing or unreadable order is the deck setting; it never discards the setup.
	const order = parseNewOrder(newOrder);
	if (order !== null) config.newOrder = order;
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
