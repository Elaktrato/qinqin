// The pictures of entries for the visual aids (#212): one question per entry per session (the server answers
// "none" for most words, which is remembered too). A network error shows nothing and is not remembered. When the
// server cannot be reached, the images packages kept on the device answer (#274, lib/packages/offlinePictures.ts).

import { api, ApiError } from '$lib/api/client';
import { getEntry } from '$lib/api/entries';
import { entryPicture, type EntryPicture } from '$lib/api/images';
import { OfflinePictures } from '$lib/packages/offlinePictures';
import { PackageStore, platformCaches } from '$lib/packages/store';

/** The reasons a learner gives for a wrong picture (docs/contracts/images/README.md, "Reports"). */
export const PICTURE_REPORT_REASONS = ['wrong', 'unclear', 'offensive', 'other'] as const;
export type PictureReportReason = (typeof PICTURE_REPORT_REASONS)[number];

/** The device's kept packages and the API, as the app uses them. */
export function deviceOfflinePictures(): OfflinePictures {
	return new OfflinePictures({
		store: () => {
			const caches = platformCaches();
			return caches === undefined || typeof location === 'undefined' ? null : new PackageStore(caches, location.origin);
		},
		entry: (id) => getEntry(id),
		reported: async () => (await api<{ reports: { entryId: number; packId: string; concept: string }[] }>('/api/images/reports')).reports
	});
}

/** A per-session cache (record 0009): entry id -> picture, or null when the entry has none. */
export class PictureCache {
	readonly loaded = new Map<number, EntryPicture | null>();
	readonly inFlight = new Map<number, Promise<EntryPicture | null>>();
	/** The kept images packages (offline answers). */
	readonly offline: OfflinePictures;

	constructor(offline: OfflinePictures = deviceOfflinePictures()) {
		this.offline = offline;
	}

	/** The remembered answer: a picture, null (none), or undefined (not asked yet). */
	peek(entryId: number): EntryPicture | null | undefined {
		return this.loaded.get(entryId);
	}

	clear(): void {
		this.loaded.clear();
		this.inFlight.clear();
		this.offline.reset();
	}
}

/** unreachable: the request reached no server (a network error) or a gateway said so (502, 503, 504). */
export function unreachable(err: unknown): boolean {
	if (err instanceof DOMException && err.name === 'AbortError') return false;
	if (err instanceof ApiError) return err.status === 502 || err.status === 503 || err.status === 504;
	return true;
}

/**
 * onlineOrKept: the server's answer while it can be reached; otherwise the kept packages' answer. With nothing kept
 * (or no saved copy of the entry) the server's error stands, so the entry is asked again later.
 */
export async function onlineOrKept(
	entryId: number,
	offline: OfflinePictures,
	online: (id: number) => Promise<EntryPicture | null> = (id) => entryPicture(id)
): Promise<EntryPicture | null> {
	try {
		return await online(entryId);
	} catch (err) {
		if (!unreachable(err)) throw err;
		let kept: EntryPicture | null | undefined;
		try {
			kept = await offline.lookup(entryId);
		} catch {
			kept = undefined;
		}
		if (kept === undefined) throw err;
		return kept;
	}
}

/** pictureFor: the picture of an entry (null for none or on an error); concurrent callers share one request. */
export function pictureFor(
	cache: PictureCache,
	entryId: number,
	fetcher: (id: number) => Promise<EntryPicture | null> = (id) => onlineOrKept(id, cache.offline)
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

/**
 * reportPicture sends the learner's report of an entry's picture (POST /api/images/reports) and forgets the
 * remembered answer, so the next ask shows the next picture, or none. Rejects like any api call.
 */
export async function reportPicture(
	cache: PictureCache,
	entryId: number,
	picture: Pick<EntryPicture, 'packId' | 'concept'>,
	reason: PictureReportReason,
	send: (body: unknown) => Promise<unknown> = (body) => api('/api/images/reports', { method: 'POST', body })
): Promise<void> {
	await send({ entryId, packId: picture.packId, concept: picture.concept, reason });
	cache.offline.noteReported(entryId, picture.packId, picture.concept);
	cache.loaded.delete(entryId);
	cache.inFlight.delete(entryId);
}
