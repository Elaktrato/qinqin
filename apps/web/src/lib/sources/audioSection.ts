import { packTable, type PackTable } from './sections';

/** One element of GET /api/audio-packs. */
export interface AudioPackInfo {
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	notice?: string;
	clipCount: number;
}

export interface AudioSection {
	table: PackTable;
	/** Row key to the per-recording credits URL, for packs whose licence is "per file". */
	creditsHref: Record<number, string>;
}

/**
 * audioSection prepares the Sources page's Audio table: the packs' licence,
 * attribution and notice, and a link to the per-recording credits for a
 * pack whose licence is per file (every recording has its own). Null when
 * no audio pack is installed, so the page shows no section.
 */
export function audioSection(packs: AudioPackInfo[]): AudioSection | null {
	if (packs.length === 0) return null;
	const table = packTable(
		'audio',
		packs.map((p, i) => ({ id: i + 1, name: p.name, language: p.language, version: p.version, license: p.license, attribution: p.attribution, notice: p.notice }))
	);
	const creditsHref: Record<number, string> = {};
	packs.forEach((p, i) => {
		if (p.license.trim().toLowerCase() === 'per file') {
			creditsHref[i + 1] = `/api/audio-packs/${encodeURIComponent(p.packId)}/credits?limit=500`;
		}
	});
	return { table, creditsHref };
}
