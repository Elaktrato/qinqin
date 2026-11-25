// The items of level decks, loaded on demand: one request per level, at
// most two at a time across the page, kept for the session. A scheme's
// members change only when its pack is re-installed.

import { getSchemeEntries } from '$lib/api/schemes';
import type { EntryBase } from '$lib/api/types';
import { levelItems, type LevelDeck } from './systemDecks';
import type { LevelItemsCache } from '../../../context/caches';

const CONCURRENCY = 2;


function keyOf(deck: LevelDeck): string {
	return `${deck.schemeId}\u0000${deck.level}\u0000${deck.unit === 'character' ? 'c' : 'w'}`;
}

function slot(cache: LevelItemsCache): Promise<void> {
	if (cache.running < CONCURRENCY) {
		cache.running += 1;
		return Promise.resolve();
	}
	return new Promise((resolve) => cache.waiting.push(resolve));
}

function release(cache: LevelItemsCache): void {
	const next = cache.waiting.shift();
	if (next === undefined) cache.running -= 1;
	else next();
}

/** loadLevelItems: the deck's items (unit filter applied); failures are not cached. */
export function loadLevelItems(cache: LevelItemsCache, deck: LevelDeck): Promise<EntryBase[]> {
	const key = keyOf(deck);
	const cached = cache.loaded.get(key);
	if (cached !== undefined) return Promise.resolve(cached);
	const pending = cache.inflight.get(key);
	if (pending !== undefined) return pending;
	let promise: Promise<EntryBase[]> | undefined;
	promise = (async () => {
		await slot(cache);
		try {
			const items = levelItems(deck, await getSchemeEntries(deck.schemeId, deck.level));
			cache.loaded.set(key, items);
			return items;
		} finally {
			release(cache);
			if (cache.inflight.get(key) === promise) cache.inflight.delete(key);
		}
	})();
	cache.inflight.set(key, promise);
	return promise;
}
