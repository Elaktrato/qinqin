import { api } from './client';
import type { AudioCache } from '../context/caches';


/** One recording with its credit, as the API sends it. */
export interface AudioClip {
	url: string;
	packId: string;
	license: string;
	attribution: string;
	source: string;
}

/**
 * What an entry can play. `terms` are recordings of the whole word.
 * `syllables` is null for a language without syllable clips; otherwise it
 * has one slot per pinyin reading of the entry, in the entry's order: the
 * clips to play in sequence, or null when a syllable has no recording.
 */
export interface AudioResolution {
	terms: AudioClip[];
	syllables: (AudioClip[] | null)[] | null;
}

const CHUNK = 200;
const EMPTY: AudioResolution = { terms: [], syllables: null };

// One cache per session, shared by getEntryAudio and resolveAudio. An id the
// server does not know is cached as empty, so it is not asked for again.

/**
 * getEntryAudio queries GET /api/audio/entries/{id} (signed-in users).
 * One request per entry and session; concurrent calls share it.
 */
export function getEntryAudio(cache: AudioCache, id: number): Promise<AudioResolution> {
	const hit = cache.cache.get(id);
	if (hit) return Promise.resolve(hit);
	let p = cache.pending.get(id);
	if (!p) {
		const mine: Promise<AudioResolution> = api<AudioResolution>(`/api/audio/entries/${id}`)
			.then((r) => {
				cache.cache.set(id, r);
				return r;
			})
			.finally(() => {
				if (cache.pending.get(id) === mine) cache.pending.delete(id);
			});
		cache.pending.set(id, mine);
		p = mine;
	}
	return p;
}

/**
 * resolveAudio fetches the resolutions of many entries with
 * POST /api/audio/resolve, 200 ids per request, skipping the cached ones.
 * It never rejects: a failed chunk is left out of the result and not cached
 * (a study card must not wait on audio).
 */
export async function resolveAudio(cache: AudioCache, ids: number[]): Promise<Record<string, AudioResolution>> {
	const unique = [...new Set(ids)];
	const missing = unique.filter((id) => !cache.cache.has(id));
	for (let i = 0; i < missing.length; i += CHUNK) {
		const chunk = missing.slice(i, i + CHUNK);
		try {
			const got = await api<Record<string, AudioResolution>>('/api/audio/resolve', {
				method: 'POST',
				body: { entryIds: chunk }
			});
			for (const id of chunk) cache.cache.set(id, got[String(id)] ?? EMPTY);
		} catch {
			// Leave the chunk uncached; the next call tries again.
		}
	}
	const out: Record<string, AudioResolution> = {};
	for (const id of unique) {
		const r = cache.cache.get(id);
		if (r) out[String(id)] = r;
	}
	return out;
}
