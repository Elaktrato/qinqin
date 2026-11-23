// Legacy cards were added before StudyCard carried a `written` snapshot.
// The mastery map needs those forms, so this resolver fills only the
// missing ones from GET /api/entries/{id}. Successful resolutions are
// cached by entry id: switching the scheme or level filter must not
// refetch the same entry. A transient failure is deliberately not
// cached, so the next load retries it; until then its card simply does
// not contribute to a character score and the page reports how many
// cards stayed unresolved.

import { getEntry } from '../api/entries';
import { onSessionEnd, sessionEpoch } from '../session/sessionEnd';
import type { StudyCard } from './types';

// One page load resolves a modest number of legacy cards at a time; the
// map must stay responsive while an old deck is backfilled.
const FETCH_CONCURRENCY = 4;

// Values are successful resolutions only: a null means the entry exists
// but has no written form. Fetch failures never get a row.
const writtenByEntry = new Map<number, string | null>();
onSessionEnd(() => writtenByEntry.clear());

interface WrittenResult {
	ok: boolean;
	written: string | null;
}

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

async function fetchWritten(entryId: number): Promise<WrittenResult> {
	if (writtenByEntry.has(entryId)) {
		return { ok: true, written: writtenByEntry.get(entryId) ?? null };
	}

	const epoch = sessionEpoch();
	try {
		const entry = await getEntry(entryId);
		const written =
			typeof entry.written === 'string' && entry.written !== '' ? entry.written : null;
		// A successful lookup is stable: retrying cannot teach the API a
		// written form it does not have.
		// An answer for a session that has ended is not kept (#173).
		if (epoch === sessionEpoch()) writtenByEntry.set(entryId, written);
		return { ok: true, written };
	} catch {
		// A missing or forbidden entry, or a transient network failure:
		// leave the card out of the aggregate for now and retry on the
		// next page load instead of poisoning the cache forever.
		return { ok: false, written: null };
	}
}

/** The outcome of a backfill run, including what stayed unresolved. */
export interface BackfillResult {
	/** Cards still without a written snapshot once every attempt finished. */
	unresolvedCards: number;
}

/** Options of the progressive resolver. */
export interface BackfillOptions {
	/**
	 * Minimum time between two publishes of fetch results, in ms. The
	 * first resolution publishes at once, later ones are batched into one
	 * trailing publish per interval. Defaults to 250.
	 */
	intervalMs?: number;
}

const PUBLISH_INTERVAL_MS = 250;

/**
 * fillMissingWrittenProgressively resolves legacy snapshots in the
 * background. Fetches run with a small concurrency limit. Every publish
 * makes the page re-derive mastery over all cards, so publishes are
 * throttled by time, not by frame (a frame would flush after almost
 * every resolution): entries already in the cache are folded in with a
 * single `onProgress` up front (and are not refetched), fetch results
 * are published at most once per interval, and the complete result is
 * published before the promise settles; no timer outlives the run.
 * Failures are swallowed (and not cached) so the map still renders;
 * their count is returned for the caller to surface.
 */
export async function fillMissingWrittenProgressively(
	cards: readonly StudyCard[],
	onProgress: (cards: StudyCard[]) => void,
	options: BackfillOptions = {}
): Promise<BackfillResult> {
	const ids = missingWrittenEntryIds(cards);
	if (ids.length === 0) return { unresolvedCards: 0 };
	const interval = options.intervalMs ?? PUBLISH_INTERVAL_MS;

	const resolved = new Map<number, string | null>();
	const toFetch: number[] = [];
	for (const id of ids) {
		if (writtenByEntry.has(id)) resolved.set(id, writtenByEntry.get(id) ?? null);
		else toFetch.push(id);
	}
	// A cached "no written form" changes no card, so it needs no publish.
	if ([...resolved.values()].some((w) => w !== null)) {
		onProgress(withWritten(cards, resolved));
	}

	let next = 0;
	let dirty = false;
	let finished = false;
	let lastPublish = -Infinity;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush(): void {
		timer = null;
		if (finished || !dirty) return;
		dirty = false;
		lastPublish = Date.now();
		onProgress(withWritten(cards, resolved));
	}

	function markDirty(): void {
		dirty = true;
		if (timer !== null) return;
		const wait = lastPublish + interval - Date.now();
		if (wait <= 0) flush();
		else timer = setTimeout(flush, wait);
	}

	async function worker(): Promise<void> {
		while (next < toFetch.length) {
			const entryId = toFetch[next];
			next += 1;
			const result = await fetchWritten(entryId);
			if (!result.ok) continue;
			resolved.set(entryId, result.written);
			if (result.written !== null) markDirty();
		}
	}

	const workers = Array.from(
		{ length: Math.min(FETCH_CONCURRENCY, toFetch.length) },
		() => worker()
	);
	await Promise.all(workers);

	finished = true;
	if (timer !== null) clearTimeout(timer);
	timer = null;
	const finalCards = withWritten(cards, resolved);
	if (dirty) onProgress(finalCards);
	return {
		unresolvedCards: finalCards.filter((card) => card.written === undefined).length
	};
}

/**
 * fillMissingWritten returns the cards with legacy snapshots filled in.
 * It is the await-everything form of the progressive resolver, kept for
 * callers that do not paint intermediate state.
 */
export async function fillMissingWritten(cards: readonly StudyCard[]): Promise<StudyCard[]> {
	let result = [...cards];
	await fillMissingWrittenProgressively(cards, (nextCards) => {
		result = nextCards;
	});
	return result;
}

/** Clears the entry cache; tests use it to isolate runs. */
export function clearEntriesCache(): void {
	writtenByEntry.clear();
}
