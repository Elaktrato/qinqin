// Starter mode (#214): a display rule that shows the script of a word step by step, as the learner gets to
// know that word. The stage is derived from the vocab card's own review history, never stored (like schedules
// and mastery), and the rule is pure and shared with Android (docs/contracts/starter/stages.json, decoded by
// starter.contract.test.ts). Nothing here changes a card id, a schedule or a review: switching Starter mode off
// shows every card normally and loses nothing.
//
// The model: a word earns a POINT for a success (Good or Easy) that comes at least MIN_GAP_MINUTES after the
// last counted review, so the learning steps of one sitting do not count and a stage takes a real day.
// Hard pauses the word. Again drops it one stage (to the entry point of the previous stage). The stage is the
// highest one whose threshold the points reach, up to the word's final stage (its normal card).

import { readingLang, studyLang } from '../i18n/lang';
import type { HintKind, HintMode } from './hints';
import type { ReviewEvent, ReviewGrade } from './types';

export type StarterProfile = 'ja' | 'zh';

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const STARTER_SETTINGS_KEY = 'starter';

/** A success counts only this long after the last counted review (the learning steps of one sitting do not). */
export const MIN_GAP_MINUTES = 720;

/** Points a word needs to enter stage s: thresholds[s - 1]. */
export const STARTER_THRESHOLDS: Readonly<Record<StarterProfile, readonly number[]>> = {
	ja: [0, 1, 2, 3, 5, 7],
	zh: [0, 1, 2, 4, 6]
};

/** The language profile that has stages, or null (other languages get Starter mode when #199 defines theirs). */
export function starterProfile(language: string | undefined): StarterProfile | null {
	const base = (language ?? '').trim().toLowerCase().split('-')[0];
	return base === 'ja' || base === 'zh' ? base : null;
}

/** What the rule needs to know about the word itself: Japanese words usually written in kana stop at stage 4. */
export interface StarterWord {
	usuallyKana: boolean;
}

/** usuallyKanaOf: JMdict tags the first sense `uk` when the word is usually written in kana alone. */
export function usuallyKanaOf(entry: { senseGroups?: readonly { tags: readonly string[] }[] }): boolean {
	return (entry.senseGroups?.[0]?.tags ?? []).includes('uk');
}

/** The stage that is the word's normal card. */
export function finalStage(profile: StarterProfile, word: StarterWord): number {
	if (profile === 'ja' && word.usuallyKana) return 4;
	return STARTER_THRESHOLDS[profile].length;
}

/** One review of the card: its time and grade. */
export interface StarterReview {
	at: string;
	grade: ReviewGrade;
}

/** cardStarterReviews: the card's own reviews of an event list, as {at, grade}. */
export function cardStarterReviews(cardId: string, events: readonly ReviewEvent[]): StarterReview[] {
	const out: StarterReview[] = [];
	for (const event of events) {
		if (event?.payload?.cardId !== cardId) continue;
		out.push({ at: event.ts, grade: event.payload.grade });
	}
	return out;
}

export interface StarterProgress {
	stage: number;
	points: number;
	/** The last review moved the word up: its card shows the "New" note once. */
	justAdvanced: boolean;
}

function stageOfPoints(profile: StarterProfile, word: StarterWord, points: number): number {
	const thresholds = STARTER_THRESHOLDS[profile];
	let stage = 1;
	for (let s = 1; s <= thresholds.length; s++) if (thresholds[s - 1] <= points) stage = s;
	return Math.min(stage, finalStage(profile, word));
}

/**
 * replayStarter derives a word's stage from its card's reviews (contract starter/stages): replayed in time
 * order; a review with an unreadable time or a grade outside 1-4 is skipped.
 */
export function replayStarter(profile: StarterProfile, word: StarterWord, reviews: readonly StarterReview[]): StarterProgress {
	const rows = reviews
		.map((r) => ({ ms: Date.parse(r.at), grade: r.grade }))
		.filter((r) => Number.isFinite(r.ms) && (r.grade === 1 || r.grade === 2 || r.grade === 3 || r.grade === 4))
		.sort((a, b) => a.ms - b.ms);
	const thresholds = STARTER_THRESHOLDS[profile];
	const gap = MIN_GAP_MINUTES * 60_000;
	let points = 0;
	let lastAt: number | null = null;
	let before = 1;
	for (const row of rows) {
		before = stageOfPoints(profile, word, points);
		if (row.grade >= 3) {
			if (lastAt === null || row.ms - lastAt >= gap) {
				points += 1;
				lastAt = row.ms;
			}
		} else if (row.grade === 1) {
			points = thresholds[Math.max(1, before - 1) - 1];
			lastAt = row.ms;
		}
	}
	const stage = stageOfPoints(profile, word, points);
	return { stage, points, justAdvanced: rows.length > 0 && stage > before };
}

/** What the front of a card shows at a stage (contract starter/stages, `stages`). */
export interface StageSpec {
	stage: number;
	/** The picture: always on the front, a hint behind the Hint control, or as the normal card has it (settings). */
	picture: 'shown' | 'hint' | 'normal';
	/** The large text: romanisation (Japanese romaji), the reading (kana, pinyin) or the written word. */
	main: 'romanisation' | 'reading' | 'written';
	/** The small text beside or above the main one. */
	annotation: 'none' | 'romanisation' | 'reading';
	/** The hint modes the stage forces (resolveHints' `forced`). */
	forced: Partial<Record<HintKind, HintMode>>;
}

const JA_STAGES: readonly StageSpec[] = [
	{ stage: 1, picture: 'shown', main: 'romanisation', annotation: 'none', forced: { picture: 'always', reading: 'never' } },
	{ stage: 2, picture: 'shown', main: 'reading', annotation: 'romanisation', forced: { picture: 'always', reading: 'never' } },
	{ stage: 3, picture: 'shown', main: 'reading', annotation: 'none', forced: { picture: 'always', reading: 'never' } },
	{ stage: 4, picture: 'hint', main: 'reading', annotation: 'none', forced: { picture: 'hint', reading: 'never' } },
	{ stage: 5, picture: 'hint', main: 'written', annotation: 'reading', forced: { picture: 'hint', reading: 'never' } },
	{ stage: 6, picture: 'normal', main: 'written', annotation: 'none', forced: {} }
];

const ZH_STAGES: readonly StageSpec[] = [
	{ stage: 1, picture: 'shown', main: 'reading', annotation: 'none', forced: { picture: 'always', reading: 'never' } },
	{ stage: 2, picture: 'shown', main: 'written', annotation: 'reading', forced: { picture: 'always', reading: 'never' } },
	{ stage: 3, picture: 'hint', main: 'written', annotation: 'reading', forced: { picture: 'hint', reading: 'never' } },
	{ stage: 4, picture: 'hint', main: 'written', annotation: 'none', forced: { picture: 'hint' } },
	{ stage: 5, picture: 'normal', main: 'written', annotation: 'none', forced: {} }
];

const KANA_NORMAL: StageSpec = { stage: 4, picture: 'normal', main: 'reading', annotation: 'none', forced: {} };

/** stageSpec: the row of a stage (a stage past the word's final one is its final one). */
export function stageSpec(profile: StarterProfile, stage: number, word: StarterWord): StageSpec {
	const final = finalStage(profile, word);
	const s = Math.min(Math.max(1, Math.floor(stage)), final);
	if (profile === 'ja' && word.usuallyKana && s === final) return KANA_NORMAL;
	return (profile === 'ja' ? JA_STAGES : ZH_STAGES)[s - 1];
}

/** Whether the stage is the word's normal card: no Starter front, the card as it always was. */
export function isNormalStage(profile: StarterProfile, stage: number, word: StarterWord): boolean {
	return stage >= finalStage(profile, word);
}

/** starterForcedHints: the hint modes a stage forces, for resolveHints. */
export function starterForcedHints(profile: StarterProfile, stage: number, word: StarterWord): Partial<Record<HintKind, HintMode>> {
	return stageSpec(profile, stage, word).forced;
}

/** The entry fields a Starter front reads. */
export interface StarterEntryLike {
	language: string;
	written: string;
	readings: readonly { type: string; value: string }[];
}

/** One line of the front: its text and the `lang` it is read in. */
export interface StarterFront {
	main: string;
	mainLang: string | undefined;
	annotation: string | null;
	annotationLang: string | null | undefined;
}

type Slot = { text: string; lang: string | undefined };

function readingOf(entry: StarterEntryLike, type: string): Slot | null {
	const r = entry.readings.find((x) => x.type === type);
	return r ? { text: r.value, lang: readingLang(type, entry.language) } : null;
}

function slotFor(profile: StarterProfile, entry: StarterEntryLike, what: 'romanisation' | 'reading' | 'written'): Slot {
	const written: Slot = { text: entry.written, lang: studyLang(entry.language) };
	if (what === 'written') return written;
	// Japanese: the kana reading is shown as the dictionary stores it, so a loanword stays in katakana
	// (コーヒー) and is never converted to hiragana. Chinese: pinyin.
	const type = what === 'romanisation' ? 'romaji' : profile === 'ja' ? 'kana' : 'pinyin';
	return readingOf(entry, type) ?? written;
}

/**
 * starterFront: what the front of the card shows at this stage, or null for the word's normal card. A
 * reading the entry lacks falls back to the written form, so a card is never empty.
 */
export function starterFront(profile: StarterProfile, stage: number, word: StarterWord, entry: StarterEntryLike): StarterFront | null {
	if (isNormalStage(profile, stage, word) && !(profile === 'ja' && word.usuallyKana)) return null;
	const spec = stageSpec(profile, stage, word);
	const main = slotFor(profile, entry, spec.main);
	const note = spec.annotation === 'none' ? null : slotFor(profile, entry, spec.annotation);
	return {
		main: main.text,
		mainLang: main.lang,
		annotation: note === null || note.text === main.text ? null : note.text,
		annotationLang: note === null || note.text === main.text ? null : note.lang
	};
}

// --- Settings -------------------------------------------------------------------------------------

/** Starter mode of a workspace: on or off, and whether it also applies to the learner's own cards. */
export interface StarterSettings {
	enabled: boolean;
	/** `base`: the Starter set only; `all`: every vocab card of the workspace. */
	scope: 'base' | 'all';
}

export const DEFAULT_STARTER: StarterSettings = { enabled: false, scope: 'base' };

/** readStarterSettings reads `settings.starter`: an absent or invalid member is the default (off, base set). */
export function readStarterSettings(settings: Record<string, unknown> | null | undefined): StarterSettings {
	const stored = settings?.[STARTER_SETTINGS_KEY];
	if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return { ...DEFAULT_STARTER };
	const s = stored as Record<string, unknown>;
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_STARTER.enabled,
		scope: s.scope === 'all' || s.scope === 'base' ? s.scope : DEFAULT_STARTER.scope
	};
}

/** starterPatch: the merge patch (settings contract) that sets one or both members. */
export function starterPatch(change: Partial<StarterSettings>): Record<string, unknown> {
	return { [STARTER_SETTINGS_KEY]: { ...change } };
}

/** The deterministic id of the deck a language's Starter set is copied into. */
export function starterSetDeckId(language: string): string {
	return `d-starter-${starterProfile(language) ?? language.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** appliesToCard: Starter mode touches a card when it is on and the card is in scope. */
export function starterAppliesTo(settings: StarterSettings, language: string, deckIds: readonly string[]): boolean {
	if (!settings.enabled || starterProfile(language) === null) return false;
	return settings.scope === 'all' || deckIds.includes(starterSetDeckId(language));
}
