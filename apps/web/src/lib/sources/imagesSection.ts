import { licenseUrl } from '$lib/sources/licenses';
import type { ImagePackInfo } from '$lib/api/images';
import { packTable, type PackTable } from './sections';

export interface ImagesSection {
	show: boolean;
	table: PackTable;
	/** Row key to the licence text, for recognised licences ($lib/sources/licenses). */
	licenseHref: Record<number, string>;
	/** Row key to the languages the pack maps (the table shows all of them). */
	languages: Record<number, string[]>;
}

/**
 * imagesSection prepares the Sources page's "Pictures" block: the table of
 * GET /api/image-packs with each pack's licence, credit line (OpenMoji's own
 * suggested wording is the pack's attribution) and notice. It shows only while
 * a pack is installed, or on a load error (so the retry is reachable).
 */
export function imagesSection(list: ImagePackInfo[], error: string): ImagesSection {
	const table = packTable(
		'images',
		list.map((p, i) => ({
			id: i,
			name: p.name,
			language: p.languages[0] ?? '',
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	const licenseHref: Record<number, string> = {};
	const languages: Record<number, string[]> = {};
	list.forEach((p, i) => {
		languages[i] = p.languages;
		const href = licenseUrl(p.license);
		if (href) licenseHref[i] = href;
	});
	return { show: error !== '' || list.length > 0, table, licenseHref, languages };
}
