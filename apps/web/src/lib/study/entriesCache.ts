// Legacy cards were added before StudyCard carried a `written` snapshot.
// The mastery map needs those forms, so this resolver fills only the
// missing ones from GET /api/entries/{id}. Successes and failures are
// cached by entry id: switching the scheme or level filter must not
// refetch the same entry, and an entry the API cannot serve simply
// leaves its card out of the mastery aggregate instead of failing the
// page.

import { getEntry } from '../api/entries';
import type { StudyCard } from './types';

// One page load resolves a modest number of legacy cards at a time; the
// map must stay responsive while an old deck is backfilled.
const FETCH_CONCURRENCY = 4;

const writtenByEntry = new Map<number, string | null>();

/**
 * missingWrittenEntryIds lists the unique entries whose cards have no
 * written snapshot. Resolution is per entry, not per card, because cards
 * sharing an entry share its written form.
 */
export function missingWrittenEntryIds(cards: readonly StudyCard[]): number[] {
	const ids = new Set<number>();
	for (const card of cards) {
		if (card.written === undefined) ids.add(card.entryId);
	}
	return [...ids];
}

/**
 * withWritten applies resolved written forms to the cards that lack one.
 * Unresolved entries (a cached `null`) leave their card unchanged, and
 * cards that already carry a snapshot keep it — the snapshot is the
 * card's own historical form.
 */
export function withWritten(
	cards: readonly StudyCard[],
	written: ReadonlyMap<number, string | null>
): StudyCard[] {
	return cards.map((card) => {
		if (card.written !== undefined) return card;
		const resolved = written.get(card.entryId);
		if (resolved === undefined || resolved === null) return card;
		return { ...card, written: resolved };
	});
}

async function fetchWritten(entryId: number): Promise<string | null> {
	if (writtenByEntry.has(entryId)) return writtenByEntry.get(entryId) ?? null;

	let written: string | null = null;
	try {
		const entry = await getEntry(entryId);
		if (typeof entry.written === 'string' && entry.written !== '') {
			written = entry.written;
		}
	} catch {
		// A missing or forbidden entry is not fatal to the map: its cards
		// simply cannot contribute to a character score.
	}
	writtenByEntry.set(entryId, written);
	return written;
}

/**
 * fillMissingWritten returns the cards with legacy snapshots filled in.
 * Fetches run with a small concurrency limit, and every failure is
 * swallowed so the map still renders the cards it can resolve.
 */
export async function fillMissingWritten(cards: readonly StudyCard[]): Promise<StudyCard[]> {
	const ids = missingWrittenEntryIds(cards);
	if (ids.length === 0) return [...cards];

	const resolved = new Map<number, string | null>();
	let next = 0;

	async function worker(): Promise<void> {
		while (next < ids.length) {
			const entryId = ids[next];
			next += 1;
			resolved.set(entryId, await fetchWritten(entryId));
		}
	}

	const workers = Array.from(
		{ length: Math.min(FETCH_CONCURRENCY, ids.length) },
		() => worker()
	);
	await Promise.all(workers);

	return withWritten(cards, resolved);
}

/** Clears the entry cache; tests use it to isolate runs. */
export function clearEntriesCache(): void {
	writtenByEntry.clear();
}
