import { apiBlob } from '../api/client';
import type { ClipCache } from '../context/caches';

// The clip route needs the bearer token, which an <audio src> cannot send,
// so clips are fetched with the API client and played from object URLs. The
// most recent clips stay in memory (a study session replays a few); older
// ones are revoked.
const MAX_CLIPS = 40;

export interface Slot {
	promise: Promise<string>;
	url?: string;
}


// trim keeps the MAX_CLIPS most recently used clips that have finished loading:
// a clip still being fetched is never dropped, so no object URL is created for
// an entry that is already gone (it would leak), and none is revoked in use.
function trim(cache: Map<string, Slot>): void {
	for (const [key, slot] of cache) {
		if (cache.size <= MAX_CLIPS) return;
		if (slot.url === undefined) continue;
		cache.delete(key);
		URL.revokeObjectURL(slot.url);
	}
}

/** readyClipUrl is the object URL of a clip that has already been fetched, else null; it never waits. */
export function readyClipUrl(clips: ClipCache, clipUrl: string): string | null {
	return clips.slots.get(clipUrl)?.url ?? null;
}

/** clipObjectUrl returns a playable object URL for a clip URL, fetching it once. */
export function clipObjectUrl(clips: ClipCache, clipUrl: string): Promise<string> {
	const cache = clips.slots;
	const hit = cache.get(clipUrl);
	if (hit) {
		// Refresh its place so the least recently used goes first.
		cache.delete(clipUrl);
		cache.set(clipUrl, hit);
		return hit.promise;
	}
	const slot: Slot = {
		promise: apiBlob(clipUrl).then((blob) => {
			slot.url = URL.createObjectURL(blob);
			trim(cache);
			return slot.url;
		})
	};
	slot.promise.catch(() => {
		if (cache.get(clipUrl) === slot) cache.delete(clipUrl);
	});
	cache.set(clipUrl, slot);
	trim(cache);
	return slot.promise;
}
