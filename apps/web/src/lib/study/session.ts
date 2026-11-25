// The running study session of this tab: what Start in the study modal, or a
// deck's or level's Study, planned (decks or a level, limits, kinds, orders,
// the shuffle's seed, Study all and the page it was started from). It lives in
// sessionStorage, so a reload of /study/session keeps its order; the setup the
// modal starts from is the synced, per-workspace `study-setup` row (setup.ts).

import { t } from '$lib/i18n';
import { appPath } from '$lib/routing/here';
import { parseNewOrder, type SessionNewOrder } from './newOrder';
import type { TypeOrder } from './sessionMix';
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
	 * The order of new cards (#75). Absent = 'random', the default: a
	 * shuffle ('deck' follows the selected decks' own orders, level order
	 * in a level session).
	 */
	newOrder?: SessionNewOrder;
	/**
	 * Fixes the shuffle of a started session: drawn once when it starts, so
	 * a reload of the same session shows the same order.
	 */
	seed?: number;
	/** Ignore the session and deck daily limits for this one session. */
	studyAll?: boolean;
	/**
	 * The order of card types (#132, sessionMix.ts). Absent = 'mixed', the
	 * default: kinds interleaved, a word's cards kept apart.
	 */
	typeOrder?: TypeOrder;
	/** The app path the session was started from; its Back returns there (absent: home). */
	from?: string;
}

/** sessionNewOrder is the setup's order of new cards, random by default. */
export function sessionNewOrder(config: StudySessionConfig): SessionNewOrder {
	return config.newOrder ?? 'random';
}

/** sessionTypeOrder is the setup's order of card types, mixed by default. */
export function sessionTypeOrder(config: StudySessionConfig): TypeOrder {
	return config.typeOrder ?? 'mixed';
}

/**
 * newSessionSeed draws the seed of a session being started (#129, #132):
 * every Start, from any entry point, gets a fresh one, so each session is
 * shuffled and mixed differently and a reload of it is not.
 */
export function newSessionSeed(): number {
	return Math.floor(Math.random() * 0x7fffffff);
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

	if (config.studyAll !== true) {
		if (!isPositiveLimit(config.newLimit)) {
			errors.push(t('study.config.newLimit', { max: MAX_LIMIT }));
		}

		if (!isPositiveLimit(config.reviewLimit)) {
			errors.push(t('study.config.reviewLimit', { max: MAX_LIMIT }));
		}
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
	const { mode, schemeId, levelName, deckIds, newLimit, reviewLimit, cardTypes, newOrder, studyAll, seed, typeOrder, from } =
		parsed;
	if (!isStringArray(deckIds) || !isStringArray(cardTypes)) return null;
	if (typeof newLimit !== 'number' || typeof reviewLimit !== 'number') return null;

	// Only a path of this app: a stored address cannot send Back to another site.
	const origin = appPath(typeof from === 'string' ? from : null);

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
		cardTypes: [...cardTypes],
		...(studyAll === true ? { studyAll: true } : {}),
		...(typeof seed === 'number' && Number.isFinite(seed) ? { seed } : {}),
		// An unknown order of card types is the default (mixed); it never discards the setup.
		...(typeOrder === 'mixed' || typeOrder === 'grouped' ? { typeOrder } : {}),
		...(origin !== null ? { from: origin } : {})
	};
	// A missing or unreadable order is the default (random); it never discards the setup.
	if (newOrder === 'deck' || newOrder === 'random') config.newOrder = newOrder;
	else {
		const order = parseNewOrder(newOrder);
		if (order !== null) config.newOrder = order;
	}
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

/** sessionStorage key of the seed drawn for a setup that carries none. */
export const SESSION_SEED_KEY = 'qinqin.study.sessionSeed';

/**
 * sessionSeedOf is the seed a session runs with: the setup's, else one
 * drawn once per tab and kept, so a reload of the session keeps its order
 * even for a setup saved before seeds existed (or none at all). The setup
 * itself is not rewritten: a tab without a setup keeps having none.
 */
export function sessionSeedOf(config: StudySessionConfig): number {
	if (typeof config.seed === 'number' && Number.isFinite(config.seed)) return config.seed;
	const store = storage();
	try {
		const raw = store?.getItem(SESSION_SEED_KEY) ?? null;
		if (raw !== null && /^\d+$/.test(raw)) return Number(raw);
	} catch {
		// Blocked storage: a seed for this load only.
	}
	const seed = newSessionSeed();
	try {
		store?.setItem(SESSION_SEED_KEY, String(seed));
	} catch {
		// Private mode or a full quota: the session still starts.
	}
	return seed;
}
