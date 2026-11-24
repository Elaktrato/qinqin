// Entry ranks for "most frequent first" (#75): POST
// /api/entries/frequency-ranks in chunks of 500, at most two requests in
// flight, cached per language and ranking pack for the page. Ranks are
// shared data (no overlay), so the cache survives a sign-out unharmed;
// a different ranking pack (re-installed) drops the older ranks. A
// failure rejects and is not cached; chunks that succeeded stay.

import { UserError } from '$lib/api/userError';
import { getEntryRanks } from '$lib/api/frequency';
import type { RanksCache } from '../context/caches';


export const RANKS_CHUNK = 500;
const CONCURRENCY = 2;

export interface RanksResult {
	pack: { id: number; packId: string; name: string } | null;
	rankOf: (entryId: number) => number | null;
}

export interface LanguageRanks {
	pack: { id: number; packId: string; name: string } | null | undefined; // undefined = not asked yet
	ranks: Map<number, number | null>;
}


function stateOf(cache: RanksCache, language: string): LanguageRanks {
	let state = cache.byLanguage.get(language);
	if (state === undefined) {
		state = { pack: undefined, ranks: new Map() };
		cache.byLanguage.set(language, state);
	}
	return state;
}

function result(state: LanguageRanks): RanksResult {
	const ranks = state.ranks;
	return { pack: state.pack ?? null, rankOf: (id) => ranks.get(id) ?? null };
}

/**
 * loadRanks returns the ranking pack of `language` and each entry's rank
 * there (null = no data). Only ids not yet known are requested.
 */
export async function loadRanks(
	cache: RanksCache,
	language: string,
	entryIds: readonly number[]
): Promise<RanksResult> {
	// A ranking pack re-installed in the middle of a load drops what the older
	// pack answered; the dropped ids are asked again, a few times at most.
	for (let attempt = 0; attempt < 3; attempt++) {
		const switched = await loadOnce(cache, language, entryIds);
		const state = stateOf(cache, language);
		if (!switched || entryIds.every((id) => state.ranks.has(id))) return result(state);
	}
	throw new UserError('study.freq.listChanged');
}

/** loadOnce asks for the ids not known yet; true when the ranking pack changed meanwhile. */
async function loadOnce(cache: RanksCache, language: string, entryIds: readonly number[]): Promise<boolean> {
	const state = stateOf(cache, language);
	const missing = [...new Set(entryIds)].filter((id) => !state.ranks.has(id));
	const parts: number[][] = [];
	for (let i = 0; i < missing.length; i += RANKS_CHUNK)
		parts.push(missing.slice(i, i + RANKS_CHUNK));

	let next = 0;
	let failure: unknown = null;
	let switched = false;
	const worker = async (): Promise<void> => {
		for (;;) {
			const part = parts[next++];
			if (part === undefined || failure !== null) return;
			try {
				const body = await getEntryRanks(language, part);
				const pack =
					body.pack === null
						? null
						: { id: body.pack.id, packId: body.pack.packId, name: body.pack.name };
				if (state.pack !== undefined && (state.pack?.id ?? null) !== (pack?.id ?? null)) {
					state.ranks = new Map(); // another ranking pack: older ranks do not apply
					switched = true;
				}
				state.pack = pack;
				const got = new Map(
					(Array.isArray(body.ranks) ? body.ranks : []).map((r) => [r.id, r.rank])
				);
				for (const id of part) state.ranks.set(id, got.get(id) ?? null);
			} catch (err) {
				failure = err;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, parts.length) }, worker));
	if (failure !== null) throw failure;
	return switched;
}
