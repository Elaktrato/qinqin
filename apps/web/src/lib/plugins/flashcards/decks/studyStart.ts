// Starting a study session from the decks view: the same setup the /study
// page writes (sessionStorage), prepared for one deck or one level.

import {
	effectiveCardTypes,
	effectiveKinds,
	hasTabSetup,
	loadExtraChoices,
	loadRememberedTypes,
	type ExtraChoices
} from '$lib/study/cardTypesMemory';
import { enabledKinds, type DeckSettings } from '$lib/study/deckSettings';
import { loadConfig, type StudySessionConfig } from '$lib/study/session';
import { OPT_IN_KINDS, type OptInKind, type StudyCardKind } from '$lib/study/types';

/** A session over this deck only: the saved limits and the deck's effective kinds. */
export function deckSessionConfig(
	base: StudySessionConfig,
	deckId: string,
	kinds: readonly string[]
): StudySessionConfig {
	return { ...base, mode: 'decks', deckIds: [deckId], cardTypes: [...kinds] };
}

/**
 * A level session. It always studies vocab (without it the level queue is
 * empty) and never plans reverse or cloze cards.
 */
export function levelSessionConfig(
	base: StudySessionConfig,
	schemeId: number,
	levelName: string
): StudySessionConfig {
	const kept = base.cardTypes.filter((kind) => !OPT_IN_KINDS.includes(kind as OptInKind));
	return {
		...base,
		mode: 'levels',
		schemeId,
		levelName,
		cardTypes: kept.includes('vocab') ? kept : ['vocab', ...kept]
	};
}

/**
 * The kinds a session over `deckIds` studies: this tab's setup, else the
 * kinds last started in the workspace, else vocab, plus each opt-in kind a
 * deck in scope enables and the learner has not unchecked (the same rule
 * as the setup page and the home widget).
 */
export function deckKinds(
	deckIds: readonly string[],
	settings: Record<string, DeckSettings> | undefined,
	tabTypes: readonly string[] | null,
	remembered: StudyCardKind[] | null,
	choices: ExtraChoices
): StudyCardKind[] {
	return effectiveKinds(effectiveCardTypes(tabTypes, remembered), enabledKinds(settings, deckIds), choices);
}

/** deckKinds with this tab's setup and this workspace's remembered choices read from storage. */
export function sessionKinds(
	workspaceId: number,
	deckIds: readonly string[],
	settings: Record<string, DeckSettings> | undefined
): StudyCardKind[] {
	return deckKinds(
		deckIds,
		settings,
		hasTabSetup() ? loadConfig().cardTypes : null,
		loadRememberedTypes(workspaceId),
		loadExtraChoices(workspaceId)
	);
}
