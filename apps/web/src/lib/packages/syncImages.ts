// Installing the images packages of a language on this device (#274; docs/contracts/images/README.md, "Offline"):
// the catalogue rows of type images that cover the language, each decided by the client rule (packageAction),
// downloaded, checked whole (checkPackage), read once (so a file the reader cannot read is never kept) and kept
// (PackageStore). Offline preparation runs it; nothing else downloads a package.
import type { Catalogue } from '../api/packages';
import { checkPackage } from './check';
import { IMAGES_FORMATS, readImagesPackage } from './imagesIndex';
import type { PackageStore } from './store';
import { packageAction } from './versioning';

export interface SyncImagesDeps {
	language: string;
	catalogue: () => Promise<Catalogue | null>;
	download: (url: string) => Promise<Uint8Array>;
	store: PackageStore;
}

export interface SyncImagesResult {
	downloaded: string[];
	removed: string[];
	/** Bytes downloaded this round. */
	bytes: number;
}

/** syncImagePackages brings the kept images packages of `language` up to the catalogue. Throws on a failed step. */
export async function syncImagePackages(d: SyncImagesDeps): Promise<SyncImagesResult> {
	const out: SyncImagesResult = { downloaded: [], removed: [], bytes: 0 };
	// A profile code (zh-TW) asks for its primary language's packages.
	const language = d.language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	const catalogue = await d.catalogue();
	if (catalogue === null) return out;
	let kept = await d.store.list();
	if (kept.some((k) => k.instanceId !== catalogue.instanceId)) {
		// Another database behind the same address: nothing kept belongs to it.
		await d.store.clear();
		out.removed.push(...kept.map((k) => k.id));
		kept = [];
	}
	for (const row of catalogue.packages) {
		if (row.type !== 'images' || !row.languages.includes(language)) continue;
		const have = kept.find((k) => k.id === row.id) ?? null;
		const action = packageAction(have, row, IMAGES_FORMATS, have?.instanceId ?? null, catalogue.instanceId);
		if (action === 'delete') {
			await d.store.remove(row.id);
			out.removed.push(row.id);
		}
		if (action !== 'download' || row.url === null) continue;
		const bytes = await d.download(row.url);
		const checked = await checkPackage(bytes, row, catalogue.instanceId, IMAGES_FORMATS);
		readImagesPackage(checked.files.get('data.sqlite') ?? new Uint8Array());
		await d.store.put(
			{ id: row.id, type: row.type, revision: row.revision, contentHash: row.contentHash, formatVersion: row.formatVersion, instanceId: catalogue.instanceId, languages: row.languages, bytes: row.bytes },
			bytes
		);
		out.downloaded.push(row.id);
		out.bytes += bytes.length;
	}
	return out;
}
