// Level keys for "by level" (#75): an entry's key is the ord of its first
// level in the scheme (level order, then level id), loaded through the
// decks view's level item cache (one request per level, kept for the
// session). Entries outside the scheme have no key.

import type { Scheme } from '$lib/api/types';
import type { LevelItemsCache } from '$lib/context/caches';
import { loadLevelItems } from '$lib/features/flashcards/decks/systemDeckItems';
import { levelDecks } from '$lib/features/flashcards/decks/systemDecks';

export async function loadLevelKeys(cache: LevelItemsCache, scheme: Scheme): Promise<(entryId: number) => number | null> {
	const decks = levelDecks([scheme], scheme.language);
	const levels = await Promise.all(decks.map((deck) => loadLevelItems(cache, deck)));
	const keys = new Map<number, number>();
	decks.forEach((deck, i) => {
		for (const entry of levels[i]) if (!keys.has(entry.id)) keys.set(entry.id, deck.ord);
	});
	return (entryId) => keys.get(entryId) ?? null;
}
