// The picture of an entry when the server cannot be reached (#274): the kept images packages (store.ts), read once
// per session, asked with the entry's `pictureTargets` and the caller's reported pictures, by the server's rule
// (resolvePicture). One instance per session (record 0009), held by the session's picture cache.
import { safeSvg, type EntryPicture } from '../api/images';
import { checkPackage, sha256Hex } from './check';
import { IMAGES_FORMATS, readImagesPackage, resolvePicture, type ImagesIndex, type PictureKey } from './imagesIndex';
import type { PackageStore } from './store';

export interface OfflineEntry {
	language: string;
	pictureTargets?: string[];
}

export interface OfflinePictureDeps {
	store: () => PackageStore | null;
	/** The entry answer (the worker's saved copy offline). */
	entry: (id: number) => Promise<OfflineEntry>;
	/** The caller's reported pictures (GET /api/images/reports, the worker's saved copy offline). */
	reported: () => Promise<{ entryId: number; packId: string; concept: string }[]>;
}

export class OfflinePictures {
	readonly #deps: OfflinePictureDeps;
	#indexes: Promise<ImagesIndex[]> | null = null;
	/** Reports made in this session, before the saved list knows them. */
	readonly #reportedNow: { entryId: number; packId: string; concept: string }[] = [];

	constructor(deps: OfflinePictureDeps) {
		this.#deps = deps;
	}

	/** Forget what was read (new packages were kept, or the session ends). */
	reset(): void {
		this.#indexes = null;
		this.#reportedNow.length = 0;
	}

	/** Remember a report made now, so the kept packages pass that picture over too. */
	noteReported(entryId: number, packId: string, concept: string): void {
		this.#reportedNow.push({ entryId, packId, concept });
	}

	/** The kept images packages, read once; a package that no longer reads is left out. */
	indexes(): Promise<ImagesIndex[]> {
		this.#indexes ??= (async () => {
			const store = this.#deps.store();
			if (store === null) return [];
			const out: ImagesIndex[] = [];
			for (const kept of await store.list()) {
				if (kept.type !== 'images') continue;
				try {
					const file = await store.read(kept.id);
					if (file === null) continue;
					const checked = await checkPackage(file.bytes, { id: kept.id, revision: kept.revision, contentHash: kept.contentHash, sha256: await sha256Hex(file.bytes) }, kept.instanceId, IMAGES_FORMATS);
					out.push(readImagesPackage(checked.files.get('data.sqlite') ?? new Uint8Array()));
				} catch {
					// A kept file that no longer reads: no offline pictures from it.
				}
			}
			return out;
		})();
		return this.#indexes;
	}

	/**
	 * lookup: the entry's picture from the kept packages, null when they map none, undefined when nothing is kept
	 * (no answer either way). The entry is read through `deps.entry`, which rejects offline for an entry the worker
	 * did not save.
	 */
	async lookup(entryId: number, sense = 0): Promise<EntryPicture | null | undefined> {
		const indexes = await this.indexes();
		if (indexes.length === 0) return undefined;
		const entry = await this.#deps.entry(entryId);
		let reported: { entryId: number; packId: string; concept: string }[] = [];
		try {
			reported = await this.#deps.reported();
		} catch {
			// No saved report list: only this session's reports are passed over.
		}
		const skip: PictureKey[] = [...reported, ...this.#reportedNow].filter((r) => r.entryId === entryId).map((r) => ({ packId: r.packId, concept: r.concept }));
		const found = resolvePicture(indexes, entry.language, entry.pictureTargets ?? [], sense, skip);
		if (found === null) return null;
		const svg = safeSvg(found.svg);
		return svg === null ? null : { ...found, svg };
	}
}
