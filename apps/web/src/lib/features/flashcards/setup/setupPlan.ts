// What a study setup would study today (moved from the study page for the
// study modal): due and new counts, what Study all would add, the number of
// cards Start plans under the saved limits, the type warnings and the line
// that says why nothing can start. Pure: the real planners (cardFlow,
// levelQueue) with the data the caller loaded.

import { t } from '$lib/i18n';
import type { EntryBase, Scheme } from '$lib/api/types';
import { deckSessionItems, sessionCounts } from '../session/cardFlow';
import type { DeckSettings } from '$lib/studycore/deckSettings';
import { levelEntryCount, levelPlanCounts, levelTypeWarnings, levelUsable, type LevelUnit } from '../session/levelQueue';
import { limitsOf } from '$lib/studycore/limits';
import { cardsInDecks } from '$lib/studycore/readModel';
import { CARD_TYPES, type StudySessionMode } from '../session/session';
import { buriedLevelEntries, buriedNow } from '../session/siblings';
import { hasStrokeData } from '$lib/writing/strokeIndex';
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
	/** `kind:entryId` companions this tab already found unsuitable. */
	skip?: ReadonlySet<string>;
	level: SetupLevelInput;
}

export interface Counts {
	due: number;
	fresh: number;
}

export interface SetupPlan {
	counts: Counts;
	/** What Study all would contain (no session cap, no daily limit). */
	allCounts: Counts;
	/** The cards Start plans: the counts under the saved limits. */
	session: number;
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

function deckCounts(input: SetupPlanInput, now: Date, studyAll: boolean): { due: number; fresh: number; byKind: Record<StudyCardKind, number> } {
	if (input.deckIds.length === 0 || input.kinds.length === 0) return { due: 0, fresh: 0, byKind: { ...NO_KINDS } };
	const items = deckSessionItems({
		cards: input.cards,
		reviews: input.reviews,
		deckIds: input.deckIds,
		kinds: input.kinds,
		newLimit: COUNT_CAP,
		reviewLimit: COUNT_CAP,
		now,
		w: input.weights,
		language: input.language,
		deckSettings: input.deckSettings,
		ctx: input.ctx,
		skip: input.skip,
		...(studyAll ? { studyAll: true } : {})
	});
	return sessionCounts(items, input.reviews);
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
		return {
			counts,
			allCounts: levelCounts(input, unit, kinds, selected, now, true),
			session: capped(counts),
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
	const warnings =
		selectedCards.length === 0
			? []
			: input.kinds
					.filter((kind) => plan.byKind[kind] === 0)
					.map((kind) => t('study.setup.nothingOfType', { type: CARD_TYPES.find((type) => type.id === kind)?.label ?? kind }));
	let guidance = '';
	if (input.status === 'no-workspace') guidance = t('study.guide.noWorkspace');
	else if (input.status === 'loading') guidance = t('study.guide.loading');
	else if (input.kinds.length === 0) guidance = t('study.config.selectType');
	else if (input.deckIds.length === 0) guidance = t('study.guide.selectDeck');
	else if (selectedCards.length === 0) guidance = t('study.guide.noCards');
	else if (counts.due + counts.fresh === 0) guidance = t('study.guide.decksDone');
	return {
		counts,
		allCounts: { due: all.due, fresh: all.fresh },
		session: capped(counts),
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
