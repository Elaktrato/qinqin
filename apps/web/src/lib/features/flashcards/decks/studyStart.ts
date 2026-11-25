// Starting a one-off study session from the decks view (the study modal
// design, 4.4a): one deck or one level, with the saved setup's limits and
// orders. The saved setup itself is never changed; only the tab's running
// session (session.ts) is written.

import { enabledKinds, type DeckSettings } from '$lib/study/deckSettings';
import { newSessionSeed, type StudySessionConfig } from '$lib/study/session';
import { setupKinds, setupSessionConfig, type StudySetup } from '$lib/study/setup';
import { OPT_IN_KINDS, type OptInKind, type StudyCardKind } from '$lib/study/types';

/** A session over this deck only: the saved limits and the deck's kinds, with a fresh seed. */
export function deckSessionConfig(
	setup: StudySetup,
	deckId: string,
	kinds: readonly StudyCardKind[],
	from: string,
	seed: number = newSessionSeed()
): StudySessionConfig {
	return setupSessionConfig({ ...setup, mode: 'decks' }, [deckId], kinds, { seed, from });
}

/**
 * A level session, with a fresh seed. It always studies vocab (without it the level queue is
 * empty) and never plans reverse or cloze cards.
 */
export function levelSessionConfig(
	setup: StudySetup,
	schemeId: number,
	levelName: string,
	from: string,
	seed: number = newSessionSeed()
): StudySessionConfig {
	const kept = setup.cardTypes.filter((kind) => !OPT_IN_KINDS.includes(kind as OptInKind));
	const kinds: StudyCardKind[] = kept.includes('vocab') ? kept : ['vocab', ...kept];
	return setupSessionConfig({ ...setup, mode: 'levels', schemeId, levelName }, [], kinds, { seed, from });
}

/**
 * The kinds a session over `deckIds` studies: the saved setup's kinds plus each
 * opt-in kind a deck in scope enables and the learner has not unchecked (the
 * rule of the study modal and the home widget).
 */
export function sessionKinds(
	setup: StudySetup,
	deckIds: readonly string[],
	settings: Record<string, DeckSettings> | undefined,
	language: string
): StudyCardKind[] {
	return setupKinds(setup, enabledKinds(settings, deckIds), language);
}
