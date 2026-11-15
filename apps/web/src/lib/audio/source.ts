import { apiBlob } from '../api/client';

// The clip route needs the bearer token, which an <audio src> cannot send,
// so clips are fetched with the API client and played from object URLs. The
// most recent clips stay in memory (a study session replays a few); older
// ones are revoked.
const MAX_CLIPS = 40;

interface Slot {
	promise: Promise<string>;
	url?: string;
}
const cache = new Map<string, Slot>();

// trim keeps the MAX_CLIPS most recently used clips that have finished loading:
// a clip still being fetched is never dropped, so no object URL is created for
// an entry that is already gone (it would leak), and none is revoked in use.
function trim(): void {
	for (const [key, slot] of cache) {
		if (cache.size <= MAX_CLIPS) return;
		if (slot.url === undefined) continue;
		cache.delete(key);
		URL.revokeObjectURL(slot.url);
	}
}

/** readyClipUrl is the object URL of a clip that has already been fetched, else null; it never waits. */
export function readyClipUrl(clipUrl: string): string | null {
	return cache.get(clipUrl)?.url ?? null;
}

/** clipObjectUrl returns a playable object URL for a clip URL, fetching it once. */
export function clipObjectUrl(clipUrl: string): Promise<string> {
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
			trim();
			return slot.url;
		})
	};
	slot.promise.catch(() => {
		if (cache.get(clipUrl) === slot) cache.delete(clipUrl);
	});
	cache.set(clipUrl, slot);
	trim();
	return slot.promise;
}

/** clearClipCache revokes and forgets every clip (sign-out, tests). */
export function clearClipCache(): void {
	for (const slot of cache.values()) if (slot.url) URL.revokeObjectURL(slot.url);
	cache.clear();
}
