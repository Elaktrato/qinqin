// Level keys for "by level" (#75): an entry's key is the ord of its first
// level in the scheme (level order, then level id), loaded through the
// decks view's level item cache (one request per level, kept for the
// session). Entries outside the scheme have no key.

import type { Scheme } from '$lib/api/types';
import { loadLevelItems } from '$lib/plugins/flashcards/decks/systemDeckItems';
import { levelDecks } from '$lib/plugins/flashcards/decks/systemDecks';

export async function loadLevelKeys(scheme: Scheme): Promise<(entryId: number) => number | null> {
	const decks = levelDecks([scheme], scheme.language);
	const levels = await Promise.all(decks.map((deck) => loadLevelItems(deck)));
	const keys = new Map<number, number>();
	decks.forEach((deck, i) => {
		for (const entry of levels[i]) if (!keys.has(entry.id)) keys.set(entry.id, deck.ord);
	});
	return (entryId) => keys.get(entryId) ?? null;
}
