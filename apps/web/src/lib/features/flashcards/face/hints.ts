// Hints on a flashcard (#215): optional help the learner may ask for, one at a time, instead of
// looking at the answer. The rules are pure and shared with Android (docs/contracts/cards/, hints.json).
//
// A hint KIND is registered once below (reading and picture, the picture when an images pack maps the entry and the
// Pictures visual aid is on, #212/#216). Each kind has a MODE per card kind: always (part of the front), hint (hidden until asked)
// or never. Starter mode (#214) reuses this: it passes `forced` modes per stage instead of the settings.
// Hidden romanisation (#284): the `reading` kind offers only the readings that are shown; the hidden ones are the
// `romanisation` kind, revealed last and never stored (its mode follows the reading kind's: `never` stays `never`,
// `always` and `hint` become `hint`, so asking for it always counts as a hint).

import { CARD_KINDS, type ReviewGrade, type ReviewMeta, type StudyCardKind } from '$lib/studycore/types';
import { ROMANISATION_DEFAULTS, hiddenReadings, shownReadings, type Romanisation } from '$lib/languages/romanisation';

export const HINT_KINDS = ['reading', 'picture', 'romanisation'] as const;
export type HintKind = (typeof HINT_KINDS)[number];

/** The kinds with a row in Settings > Hints (stored under `hints`); the others derive their mode. */
export const STORED_HINT_KINDS = ['reading', 'picture'] as const satisfies readonly HintKind[];
export type StoredHintKind = (typeof STORED_HINT_KINDS)[number];

/** A derived kind's mode from the kind it follows: never stays never, anything else is a hint. */
const DERIVED: Partial<Record<HintKind, HintKind>> = { romanisation: 'reading' };
const derivedMode = (followed: HintMode): HintMode => (followed === 'never' ? 'never' : 'hint');

export const HINT_MODES = ['always', 'hint', 'never'] as const;
export type HintMode = (typeof HINT_MODES)[number];

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const HINTS_SETTINGS_KEY = 'hints';

/** What an entry can offer as a hint. */
export interface HintEntry {
	/** A reading the learner is shown (hidden romanisation left out). */
	hasReading: boolean;
	hasPicture: boolean;
	/** A reading the hidden-romanisation setting hides (#284); absent = none. */
	hasRomanisation?: boolean;
}

export interface HintKindDef {
	id: HintKind;
	/** Whether the kind can show anything yet; false shows a note in Settings and offers nothing on a card. */
	ready: boolean;
	/** Whether the kind makes sense on this card kind (a reading would be the answer of a tone card). */
	applies: (cardKind: StudyCardKind) => boolean;
	/** Whether this entry has something to show. */
	available: (entry: HintEntry) => boolean;
	defaults: Readonly<Record<StudyCardKind, HintMode>>;
}

/** The registry, in the fixed order hints are revealed in. */
export const HINT_REGISTRY: readonly HintKindDef[] = [
	{
		id: 'reading',
		ready: true,
		applies: (cardKind) => cardKind !== 'tone',
		available: (entry) => entry.hasReading,
		// The writing card has always shown the reading with the word.
		defaults: { vocab: 'hint', sentence: 'hint', writing: 'always', tone: 'never', reverse: 'hint', cloze: 'hint' }
	},
	{
		id: 'picture',
		// #212/#216: the images packs map words to pictures; `hasPicture` is true when the entry has one and the
		// Pictures visual aid is on (the session asks entryPicture and passes it to hintsForEntry).
		ready: true,
		applies: () => true,
		available: (entry) => entry.hasPicture,
		defaults: { vocab: 'hint', sentence: 'never', writing: 'hint', tone: 'hint', reverse: 'hint', cloze: 'never' }
	},
	{
		id: 'romanisation',
		// #284: the readings the workspace hides, last. Its defaults are the reading kind's, derived.
		ready: true,
		applies: (cardKind) => cardKind !== 'tone',
		available: (entry) => entry.hasRomanisation === true,
		defaults: { vocab: 'hint', sentence: 'hint', writing: 'hint', tone: 'never', reverse: 'hint', cloze: 'hint' }
	}
];

function def(kind: HintKind): HintKindDef {
	return HINT_REGISTRY.find((d) => d.id === kind) as HintKindDef;
}

export const defaultHintMode = (kind: HintKind, cardKind: StudyCardKind): HintMode => def(kind).defaults[cardKind];
export const hintApplies = (kind: HintKind, cardKind: StudyCardKind): boolean => def(kind).applies(cardKind);
export const hintReady = (kind: HintKind): boolean => def(kind).ready;

/** The mode of every hint kind on every card kind. */
export type HintSettings = Record<HintKind, Record<StudyCardKind, HintMode>>;

const isMode = (v: unknown): v is HintMode => typeof v === 'string' && (HINT_MODES as readonly string[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * readHintSettings reads `settings.hints` of a workspace: a cell that is absent or invalid is the default,
 * unknown members are ignored, and a pair that does not apply is `never`.
 */
export function readHintSettings(settings: Record<string, unknown> | null | undefined): HintSettings {
	const stored = settings?.[HINTS_SETTINGS_KEY];
	const root = isObject(stored) ? stored : {};
	const out = {} as HintSettings;
	for (const kind of STORED_HINT_KINDS) {
		const cells = isObject(root[kind]) ? (root[kind] as Record<string, unknown>) : {};
		const row = {} as Record<StudyCardKind, HintMode>;
		for (const card of CARD_KINDS) {
			const value = cells[card];
			row[card] = !hintApplies(kind, card) ? 'never' : isMode(value) ? value : defaultHintMode(kind, card);
		}
		out[kind] = row;
	}
	for (const kind of HINT_KINDS) {
		const followed = DERIVED[kind];
		if (followed === undefined) continue;
		const row = {} as Record<StudyCardKind, HintMode>;
		for (const card of CARD_KINDS) row[card] = !hintApplies(kind, card) ? 'never' : derivedMode(out[followed][card]);
		out[kind] = row;
	}
	return out;
}

/** hintPatch: the merge patch (settings contract) that sets one cell. */
export function hintPatch(kind: StoredHintKind, cardKind: StudyCardKind, mode: HintMode): Record<string, unknown> {
	return { [HINTS_SETTINGS_KEY]: { [kind]: { [cardKind]: mode } } };
}

/**
 * hintsForEntry: what an entry can offer: its shown readings, its hidden ones (`romanisation`, the workspace's
 * hidden-romanisation setting; the default hides none), and a picture when the caller knows one is shown
 * (`hasPicture`: an images pack maps the entry and the Pictures visual aid is on; the default is none).
 */
export function hintsForEntry(
	entry: { readings: readonly { type: string; value?: string }[] },
	opts: { hasPicture?: boolean; romanisation?: Readonly<Romanisation> } = {}
): HintEntry {
	const prefs = opts.romanisation ?? ROMANISATION_DEFAULTS;
	return {
		hasReading: shownReadings(entry.readings, prefs).length > 0,
		hasPicture: opts.hasPicture === true,
		hasRomanisation: hiddenReadings(entry.readings, prefs).length > 0
	};
}

/** The hints of one card: shown from the start, and offered one at a time (both in the fixed order). */
export interface HintPlan {
	always: HintKind[];
	onRequest: HintKind[];
}

export const EMPTY_PLAN: HintPlan = { always: [], onRequest: [] };

/**
 * resolveHints plans one card. `forced` (Starter mode, #214) replaces the mode of a kind for this card.
 * A kind that does not apply, or that the entry cannot offer, is left out whatever its mode.
 */
export function resolveHints(args: {
	cardKind: StudyCardKind;
	settings: HintSettings;
	entry: HintEntry;
	forced?: Partial<Record<HintKind, HintMode>>;
}): HintPlan {
	const plan: HintPlan = { always: [], onRequest: [] };
	const modeOf = (kind: HintKind): HintMode => args.forced?.[kind] ?? args.settings[kind][args.cardKind];
	for (const d of HINT_REGISTRY) {
		if (!d.applies(args.cardKind) || !d.available(args.entry)) continue;
		const followed = DERIVED[d.id];
		const mode = followed === undefined || args.forced?.[d.id] !== undefined ? modeOf(d.id) : derivedMode(modeOf(followed));
		if (mode === 'always') plan.always.push(d.id);
		else if (mode === 'hint') plan.onRequest.push(d.id);
	}
	return plan;
}

/** The hints on view after `revealed` presses of the Hint control. */
export function visibleHints(plan: HintPlan, revealed: number): HintKind[] {
	return [...plan.always, ...plan.onRequest.slice(0, Math.max(0, revealed))];
}

/** The hint the next press reveals, or null when none is left. */
export function nextHint(plan: HintPlan, revealed: number): HintKind | null {
	return plan.onRequest[Math.max(0, revealed)] ?? null;
}

/**
 * lowerForHints: a card answered after asking for a hint is suggested one step lower (owner ruling 2026-11-26):
 * Easy (4) becomes Good (3), Good (3) becomes Hard (2); Hard stays Hard and Again stays Again. A card without a
 * suggestion (self-graded) counts as Good and so is suggested Hard. A second hint lowers no further. Hints shown
 * "always" are part of the front and are not counted.
 */
export function lowerForHints(suggested: ReviewGrade | null, used: number): ReviewGrade | null {
	if (used <= 0) return suggested;
	if (suggested === null) return 2;
	if (suggested === 4) return 3;
	if (suggested === 3) return 2;
	return suggested;
}

/** applyHints: the card's result with the hint rule applied and the hints added to `meta.hints`. */
export function applyHints(
	result: { suggested: ReviewGrade | null; meta: ReviewMeta },
	used: number
): { suggested: ReviewGrade | null; meta: ReviewMeta } {
	if (used <= 0) return result;
	return {
		suggested: lowerForHints(result.suggested, used),
		meta: { ...result.meta, hints: (result.meta.hints ?? 0) + used }
	};
}
