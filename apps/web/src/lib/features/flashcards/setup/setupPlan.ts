// What a study setup would study today (moved from the study page for the
// study modal): due and new counts, what Study all would add, the number of
// cards Start plans under the saved limits (the queue itself, #288), which card
// types have anything to study (#289), the type warnings and the line that says
// why nothing can start. Pure: the real planners (cardFlow, levelQueue) with
// the data the caller loaded.

import { t } from '$lib/i18n';
import type { EntryBase, Scheme } from '$lib/api/types';
import { deckSessionItems, sessionCounts } from '../session/cardFlow';
import { enabledKinds, type DeckSettings } from '$lib/studycore/deckSettings';
import { levelEntryCount, levelPlanCounts, levelTypeWarnings, levelUsable, type LevelUnit } from '../session/levelQueue';
import { limitsOf } from '$lib/studycore/limits';
import { cardsInDecks } from '$lib/studycore/readModel';
import { CARD_TYPES, type StudySessionMode } from '../session/session';
import { buriedLevelEntries, buriedNow } from '../session/siblings';
import { hasStrokeData } from '$lib/writing/strokeIndex';
import { writableChars } from '$lib/exercises/writing';
import { profileOf } from '$lib/languages/profiles';
import type { StudyContext } from '$lib/studycore/studyContext';
import { OPT_IN_KINDS, type OptInKind, type ReviewEvent, type StudyCard, type StudyCardKind } from '$lib/studycore/types';

/** The counts distinguish "none" from "some"; the session applies its own caps. */
const COUNT_CAP = 999;

export interface SetupLevelInput {
	/** The selected scheme when it is installed for the workspace language, else null. */
	scheme: Scheme | null;
	levelName: string | null;
	schemesLoaded: boolean;
	schemeError: string;
	/** How many schemes the workspace language has. */
	schemeCount: number;
	entries: readonly EntryBase[];
	loading: boolean;
	error: string;
}

export interface SetupPlanInput {
	status: 'no-workspace' | 'loading' | 'ready';
	mode: StudySessionMode;
	deckIds: readonly string[];
	/** The kinds the setup selects (setupKinds). */
	kinds: readonly StudyCardKind[];
	newLimit: number;
	reviewLimit: number;
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckSettings: Record<string, DeckSettings>;
	weights: readonly number[];
	ctx: StudyContext;
	language: string;
	/** `kind:entryId` companions the eligibility index rules out (EligibilityIndex.skip). */
	skip?: ReadonlySet<string>;
	/**
	 * Which opt-in kinds may be offered: `enabled` (the modal) those a selected
	 * deck switches on; `any` (Advanced, whose switch turns them on for every
	 * deck) each one as if switched on.
	 */
	optIns?: 'enabled' | 'any';
	level: SetupLevelInput;
}

/** Why a card type is not offered (#289). */
export type HiddenReason = 'noSentences' | 'noWriting' | 'noPinyin' | 'notInLevels' | 'nothingNow';

export interface HiddenType {
	kind: StudyCardKind;
	reason: HiddenReason;
}

export interface Counts {
	due: number;
	fresh: number;
}

export interface SetupPlan {
	counts: Counts;
	/** What Study all would contain (no session cap, no daily limit). */
	allCounts: Counts;
	/** The cards Start plans: the length of its queue under the saved limits. */
	session: number;
	/**
	 * The card types offered (the language's, opt-in ones per `optIns`) that
	 * have something to study now, due or new (the Study all plan). Every
	 * offered type while the data is not ready.
	 */
	available: StudyCardKind[];
	/** The offered types left out, with the reason; in kind order. */
	hidden: HiddenType[];
	byKind: Record<StudyCardKind, number>;
	/** Planned companion cards (made the first time they are studied). */
	companions: number;
	warnings: string[];
	/** Why Start cannot run, '' when it can. */
	guidance: string;
	/** No deck of the session has a daily limit. */
	noDailyLimit: boolean;
	levelUnit: LevelUnit;
	levelEntryTotal: number;
	/** The level resolves against the installed schemes. */
	levelSelected: boolean;
}

const NO_KINDS: Record<StudyCardKind, number> = { vocab: 0, sentence: 0, writing: 0, tone: 0, reverse: 0, cloze: 0 };

function isOptIn(kind: StudyCardKind): boolean {
	return OPT_IN_KINDS.includes(kind as OptInKind);
}

function deckItems(
	input: SetupPlanInput,
	now: Date,
	opts: { studyAll?: boolean; limits?: boolean; kinds?: readonly StudyCardKind[]; deckSettings?: Record<string, DeckSettings> } = {}
) {
	const kinds = opts.kinds ?? input.kinds;
	if (input.deckIds.length === 0 || kinds.length === 0) return [];
	return deckSessionItems({
		cards: input.cards,
		reviews: input.reviews,
		deckIds: input.deckIds,
		kinds,
		newLimit: opts.limits === true ? input.newLimit : COUNT_CAP,
		reviewLimit: opts.limits === true ? input.reviewLimit : COUNT_CAP,
		now,
		w: input.weights,
		language: input.language,
		deckSettings: opts.deckSettings ?? input.deckSettings,
		ctx: input.ctx,
		skip: input.skip,
		...(opts.studyAll === true ? { studyAll: true } : {})
	});
}

function deckCounts(input: SetupPlanInput, now: Date, studyAll: boolean): { due: number; fresh: number; byKind: Record<StudyCardKind, number> } {
	return sessionCounts(deckItems(input, now, { studyAll }), input.reviews);
}

/** The kinds the type chips may offer: the language's; opt-in ones per `optIns`, never for a level session. */
function offeredKinds(input: SetupPlanInput): StudyCardKind[] {
	const own = profileOf(input.language).cardKinds;
	if (input.mode === 'levels') return own.filter((kind) => !isOptIn(kind));
	const enabled = input.optIns === 'any' ? new Set<OptInKind>(OPT_IN_KINDS) : enabledKinds(input.deckSettings, input.deckIds);
	return own.filter((kind) => !isOptIn(kind) || enabled.has(kind as OptInKind));
}

/** The deck settings with every opt-in kind switched on for the selected decks (Advanced's view). */
function allOptIns(input: SetupPlanInput): Record<string, DeckSettings> {
	const out: Record<string, DeckSettings> = { ...input.deckSettings };
	for (const id of input.deckIds) {
		const stored = out[id];
		out[id] = { ...(stored ?? { deckId: id, extra: {} }), deckId: id, cardTypes: [...OPT_IN_KINDS] };
	}
	return out;
}

/** Why a deck selection has nothing of `kind`: no word qualifies (by the index), or nothing is due or new now. */
function deckHiddenReason(input: SetupPlanInput, kind: StudyCardKind, selected: readonly StudyCard[]): HiddenReason {
	if (kind === 'vocab' || selected.some((card) => card.kind === kind)) return 'nothingNow';
	const qualifies = selected.some(
		(card) =>
			card.kind === 'vocab' &&
			(kind === 'writing' || card.entryKind !== 'character') &&
			!(input.skip?.has(`${kind}:${card.entryId}`) ?? false) &&
			(kind !== 'writing' || card.written === undefined || writableChars(card.written).length > 0)
	);
	if (qualifies) return 'nothingNow';
	if (kind === 'sentence' || kind === 'cloze') return 'noSentences';
	if (kind === 'writing') return 'noWriting';
	if (kind === 'tone') return 'noPinyin';
	return 'nothingNow';
}

/**
 * deckAvailability: the offered kinds the Study all plan has no item of. Each
 * opt-in kind is planned in a pass of its own: a word with a queued card gets
 * no opt-in companion, and a word gets at most one (reverse preferred), so
 * planned together with the others they would look empty whenever Vocab is.
 */
function deckAvailability(input: SetupPlanInput, now: Date, offered: readonly StudyCardKind[], selected: readonly StudyCard[]): HiddenType[] {
	const deckSettings = input.optIns === 'any' ? allOptIns(input) : input.deckSettings;
	const passes = [offered.filter((kind) => !isOptIn(kind)), ...offered.filter(isOptIn).map((kind) => [kind])];
	const found = new Set<StudyCardKind>();
	for (const kinds of passes) {
		for (const item of deckItems(input, now, { studyAll: true, kinds, deckSettings })) found.add(item.kind);
	}
	return offered.filter((kind) => !found.has(kind)).map((kind) => ({ kind, reason: deckHiddenReason(input, kind, selected) }));
}

function levelAvailability(input: SetupPlanInput, unit: LevelUnit, offered: readonly StudyCardKind[], selected: boolean, now: Date): HiddenType[] {
	if (!selected || input.level.loading || input.level.entries.length === 0) return [];
	return offered.flatMap((kind): HiddenType[] => {
		if (!levelUsable(unit, [kind])) return [{ kind, reason: 'notInLevels' }];
		const counts = levelCounts(input, unit, [kind], selected, now, true);
		return counts.due + counts.fresh > 0 ? [] : [{ kind, reason: 'nothingNow' }];
	});
}

function levelCounts(input: SetupPlanInput, unit: LevelUnit, kinds: StudyCardKind[], selected: boolean, now: Date, studyAll: boolean): Counts {
	if (!selected || input.level.entries.length === 0 || !levelUsable(unit, kinds)) return { due: 0, fresh: 0 };
	const counts = levelPlanCounts({
		entries: input.level.entries,
		cards: input.cards,
		reviews: input.reviews,
		now,
		w: input.weights,
		unit,
		kinds,
		ctx: input.ctx,
		hasStrokes: hasStrokeData,
		// A word buried by a reverse or cloze answer today is left out, as in the session.
		excludeEntries: buriedLevelEntries(buriedNow({ cards: input.cards, reviews: input.reviews, now, studyDay: input.ctx.day }), input.cards),
		skip: input.skip,
		...(studyAll ? { studyAll: true } : {})
	});
	return { due: counts.due, fresh: counts.fresh };
}

function levelGuidance(input: SetupPlanInput, unit: LevelUnit, kinds: StudyCardKind[], selected: boolean, counts: Counts): string {
	const level = input.level;
	if (!level.schemesLoaded) return t('study.guide.loadingSchemes');
	if (level.schemeError) return level.schemeError;
	if (level.schemeCount === 0) return t('study.guide.noSchemes');
	if (!selected) return t('study.guide.chooseLevel');
	if (level.error) return level.error;
	if (level.loading) return t('study.guide.loadingLevel');
	if (level.entries.length === 0) return unit === 'character' ? t('study.guide.levelNoCharacters') : t('study.guide.levelNoWords');
	if (!levelUsable(unit, kinds)) return unit === 'character' ? t('study.guide.characterKinds') : t('study.guide.vocabOnly');
	if (counts.due + counts.fresh === 0) {
		if (unit === 'character' && !input.kinds.includes('vocab')) return t('study.guide.nothingToWrite');
		return t('study.guide.levelDone');
	}
	return '';
}

/** planSetup: what Start and Study all would study now. */
export function planSetup(input: SetupPlanInput, now: Date): SetupPlan {
	const unit: LevelUnit = input.level.scheme?.unit === 'character' ? 'character' : 'word';
	const selected =
		input.level.schemesLoaded &&
		input.level.scheme !== null &&
		input.level.levelName !== null &&
		input.level.scheme.levels.some((level) => level.name === input.level.levelName);
	const levelTotal = levelEntryCount(input.level.entries, unit);
	const capped = (counts: Counts): number =>
		Math.min(counts.due, input.reviewLimit) + Math.min(counts.fresh, input.newLimit);

	if (input.mode === 'levels') {
		// Level sessions never plan reverse or cloze.
		const kinds = input.kinds.filter((kind) => !isOptIn(kind));
		const counts = levelCounts(input, unit, kinds, selected, now, false);
		const guidance =
			input.status === 'no-workspace'
				? t('study.guide.noWorkspace')
				: input.status === 'loading'
					? t('study.guide.loading')
					: input.kinds.length === 0
						? t('study.config.selectType')
						: levelGuidance(input, unit, kinds, selected, counts);
		const offered = offeredKinds(input);
		const hidden = input.status === 'ready' ? levelAvailability(input, unit, offered, selected, now) : [];
		return {
			counts,
			allCounts: levelCounts(input, unit, kinds, selected, now, true),
			session: capped(counts),
			available: offered.filter((kind) => !hidden.some((h) => h.kind === kind)),
			hidden,
			byKind: { ...NO_KINDS },
			companions: 0,
			warnings: levelTypeWarnings(unit, kinds),
			guidance,
			noDailyLimit: false,
			levelUnit: unit,
			levelEntryTotal: levelTotal,
			levelSelected: selected
		};
	}

	const plan = deckCounts(input, now, false);
	const all = deckCounts(input, now, true);
	const counts = { due: plan.due, fresh: plan.fresh };
	const selectedCards = cardsInDecks(input.cards, input.deckIds);
	const offered = offeredKinds(input);
	const hidden =
		input.status === 'ready' && input.deckIds.length > 0 && selectedCards.length > 0 ? deckAvailability(input, now, offered, selectedCards) : [];
	const available = offered.filter((kind) => !hidden.some((h) => h.kind === kind));
	const warnings =
		selectedCards.length === 0
			? []
			: input.kinds
					.filter((kind) => plan.byKind[kind] === 0 && !hidden.some((h) => h.kind === kind))
					.map((kind) => t('study.setup.nothingOfType', { type: CARD_TYPES.find((type) => type.id === kind)?.label ?? kind }));
	let guidance = '';
	if (input.status === 'no-workspace') guidance = t('study.guide.noWorkspace');
	else if (input.status === 'loading') guidance = t('study.guide.loading');
	else if (input.kinds.length === 0) guidance = t('study.config.selectType');
	else if (input.deckIds.length === 0) guidance = t('study.guide.selectDeck');
	else if (selectedCards.length === 0) guidance = t('study.guide.noCards');
	else if (available.length === 0) guidance = t('study.guide.decksDone');
	else if (!input.kinds.some((kind) => available.includes(kind))) guidance = t('study.guide.otherTypes');
	else if (counts.due + counts.fresh === 0) guidance = t('study.guide.decksDone');
	return {
		counts,
		allCounts: { due: all.due, fresh: all.fresh },
		// The queue Start plans, not an estimate from the counts (#288).
		session: guidance === '' ? deckItems(input, now, { limits: true }).length : 0,
		available,
		hidden,
		byKind: plan.byKind,
		companions: plan.byKind.sentence + plan.byKind.writing + plan.byKind.tone + plan.byKind.reverse + plan.byKind.cloze,
		warnings,
		guidance,
		noDailyLimit:
			input.deckIds.length > 0 &&
			input.deckIds.every((id) => {
				const limit = limitsOf(input.ctx, id);
				return limit.new === null && limit.reviews === null;
			}),
		levelUnit: unit,
		levelEntryTotal: levelTotal,
		levelSelected: selected
	};
}
