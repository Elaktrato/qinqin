// Hints on a flashcard (#215): optional help the learner may ask for, one at a time, instead of
// looking at the answer. The rules are pure and shared with Android (docs/contracts/cards/, hints.json).
//
// A hint KIND is registered once below (reading and picture, the picture when an images pack maps the entry and the
// Pictures visual aid is on, #212/#216). Each kind has a MODE per card kind: always (part of the front), hint (hidden until asked)
// or never. Starter mode (#214) reuses this: it passes `forced` modes per stage instead of the settings.

import { CARD_KINDS, type ReviewGrade, type ReviewMeta, type StudyCardKind } from './types';

export const HINT_KINDS = ['reading', 'picture'] as const;
export type HintKind = (typeof HINT_KINDS)[number];

export const HINT_MODES = ['always', 'hint', 'never'] as const;
export type HintMode = (typeof HINT_MODES)[number];

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const HINTS_SETTINGS_KEY = 'hints';

/** What an entry can offer as a hint. */
export interface HintEntry {
	hasReading: boolean;
	hasPicture: boolean;
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
	for (const kind of HINT_KINDS) {
		const cells = isObject(root[kind]) ? (root[kind] as Record<string, unknown>) : {};
		const row = {} as Record<StudyCardKind, HintMode>;
		for (const card of CARD_KINDS) {
			const value = cells[card];
			row[card] = !hintApplies(kind, card) ? 'never' : isMode(value) ? value : defaultHintMode(kind, card);
		}
		out[kind] = row;
	}
	return out;
}

/** hintPatch: the merge patch (settings contract) that sets one cell. */
export function hintPatch(kind: HintKind, cardKind: StudyCardKind, mode: HintMode): Record<string, unknown> {
	return { [HINTS_SETTINGS_KEY]: { [kind]: { [cardKind]: mode } } };
}

/**
 * hintsForEntry: what an entry can offer: its readings, and a picture when the caller knows one is shown
 * (`hasPicture`: an images pack maps the entry and the Pictures visual aid is on; the default is none).
 */
export function hintsForEntry(entry: { readings: readonly unknown[] }, opts: { hasPicture?: boolean } = {}): HintEntry {
	return { hasReading: entry.readings.length > 0, hasPicture: opts.hasPicture === true };
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
	for (const d of HINT_REGISTRY) {
		if (!d.applies(args.cardKind) || !d.available(args.entry)) continue;
		const mode = args.forced?.[d.id] ?? args.settings[d.id][args.cardKind];
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
 * lowerForHints: a card answered after asking for a hint is suggested at most Hard (2). Again stays Again; a
 * card without a suggestion (self-graded) is suggested Hard. Hints shown "always" are part of the front and
 * are not counted.
 */
export function lowerForHints(suggested: ReviewGrade | null, used: number): ReviewGrade | null {
	if (used <= 0) return suggested;
	if (suggested === 1) return 1;
	return 2;
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
