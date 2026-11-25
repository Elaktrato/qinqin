// A scheme's levels as the entries each holds (#74), from the bundled level
// packs through the session's level cache: one request per level, kept for the
// session (the decks view shares them). Unit filter as the level decks: a
// character scheme yields characters, every other scheme words.

import type { EntryBase, Scheme } from '$lib/api/types';
import type { LevelItemsCache } from '$lib/context/caches';
import { loadLevelItems } from '$lib/features/flashcards/decks/systemDeckItems';
import { levelDecks } from '$lib/features/flashcards/decks/systemDecks';
import { isSampleScheme } from '$lib/study/charGroups';
import type { LevelMembers } from './declare';

export interface SchemeLevels {
	levels: LevelMembers[];
	/** The entries by id, for showing a placement item. */
	entries: ReadonlyMap<number, EntryBase>;
}

/** loadSchemeLevels: every level of the scheme in level order; a failed level rejects (nothing is half-declared). */
export async function loadSchemeLevels(cache: LevelItemsCache, scheme: Scheme): Promise<SchemeLevels> {
	const decks = levelDecks([scheme], scheme.language);
	const lists = await Promise.all(decks.map((deck) => loadLevelItems(cache, deck)));
	const entries = new Map<number, EntryBase>();
	const levels = decks.map((deck, i) => {
		for (const entry of lists[i]) entries.set(entry.id, entry);
		return { id: deck.ord, name: deck.level, entryIds: lists[i].map((entry) => entry.id) };
	});
	return { levels, entries };
}

function primary(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * declarableSchemes: the installed schemes of a language that can place a
 * learner: a real level list, never a bundled sample. Jōyō grades stay (grade 3
 * is a level a learner can know).
 */
export function declarableSchemes(language: string, schemes: readonly Scheme[]): Scheme[] {
	return schemes.filter((s) => primary(s.language) === primary(language) && s.levels.length > 0 && !isSampleScheme(s));
}
