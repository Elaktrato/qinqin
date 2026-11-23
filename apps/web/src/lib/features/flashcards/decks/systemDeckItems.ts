// The items of level decks, loaded on demand: one request per level, at
// most two at a time across the page, kept for the session. A scheme's
// members change only when its pack is re-installed.

import { getSchemeEntries } from '$lib/api/schemes';
import { onSessionEnd, sessionEpoch } from '$lib/session/sessionEnd';
import type { EntryBase } from '$lib/api/types';
import { levelItems, type LevelDeck } from './systemDecks';

const CONCURRENCY = 2;

const cache = new Map<string, EntryBase[]>();
const inflight = new Map<string, Promise<EntryBase[]>>();
onSessionEnd(() => {
	cache.clear();
	inflight.clear();
});
const waiting: (() => void)[] = [];
let running = 0;

function keyOf(deck: LevelDeck): string {
	return `${deck.schemeId}\u0000${deck.level}\u0000${deck.unit === 'character' ? 'c' : 'w'}`;
}

/** clearLevelItemsCache forgets every loaded level (tests, sign-out). */
export function clearLevelItemsCache(): void {
	cache.clear();
}

function slot(): Promise<void> {
	if (running < CONCURRENCY) {
		running += 1;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
	const next = waiting.shift();
	if (next === undefined) running -= 1;
	else next();
}

/** loadLevelItems: the deck's items (unit filter applied); failures are not cached. */
export function loadLevelItems(deck: LevelDeck): Promise<EntryBase[]> {
	const key = keyOf(deck);
	const cached = cache.get(key);
	if (cached !== undefined) return Promise.resolve(cached);
	const pending = inflight.get(key);
	if (pending !== undefined) return pending;
	const epoch = sessionEpoch();
	let promise: Promise<EntryBase[]> | undefined;
	promise = (async () => {
		await slot();
		try {
			const items = levelItems(deck, await getSchemeEntries(deck.schemeId, deck.level));
			// An answer for a session that has ended is not kept (#173).
			if (epoch === sessionEpoch()) cache.set(key, items);
			return items;
		} finally {
			release();
			if (inflight.get(key) === promise) inflight.delete(key);
		}
	})();
	inflight.set(key, promise);
	return promise;
}
