// The pictures of entries for the visual aids (#212): one question per entry per session (the server answers
// "none" for most words, which is remembered too). A network error shows nothing and is not remembered.

import { entryPicture, type EntryPicture } from '$lib/api/images';

/** A per-session cache (record 0009): entry id -> picture, or null when the entry has none. */
export class PictureCache {
	readonly loaded = new Map<number, EntryPicture | null>();
	readonly inFlight = new Map<number, Promise<EntryPicture | null>>();

	/** The remembered answer: a picture, null (none), or undefined (not asked yet). */
	peek(entryId: number): EntryPicture | null | undefined {
		return this.loaded.get(entryId);
	}

	clear(): void {
		this.loaded.clear();
		this.inFlight.clear();
	}
}

/** pictureFor: the picture of an entry (null for none or on an error); concurrent callers share one request. */
export function pictureFor(
	cache: PictureCache,
	entryId: number,
	fetcher: (id: number) => Promise<EntryPicture | null> = (id) => entryPicture(id)
): Promise<EntryPicture | null> {
	const known = cache.loaded.get(entryId);
	if (known !== undefined) return Promise.resolve(known);
	const pending = cache.inFlight.get(entryId);
	if (pending !== undefined) return pending;
	const promise = fetcher(entryId).then(
		(picture) => {
			if (cache.inFlight.get(entryId) === promise) {
				cache.inFlight.delete(entryId);
				cache.loaded.set(entryId, picture);
			}
			return picture;
		},
		() => {
			if (cache.inFlight.get(entryId) === promise) cache.inFlight.delete(entryId);
			return null;
		}
	);
	cache.inFlight.set(entryId, promise);
	return promise;
}
