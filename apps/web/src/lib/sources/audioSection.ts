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

export interface CreditsLink {
	label: string;
	href: string;
}

export interface AudioSection {
	table: PackTable;
	/** Row key to the per-recording credit pages (500 recordings each), for packs whose licence is "per file". */
	creditsPages: Record<number, CreditsLink[]>;
	/** Row key to the licence text, for the common Creative Commons licences. */
	licenseHref: Record<number, string>;
}

const PAGE = 500;
const LICENSES: [RegExp, string][] = [
	[/^cc by 4\.0$/i, 'https://creativecommons.org/licenses/by/4.0/'],
	[/^cc by-sa 4\.0$/i, 'https://creativecommons.org/licenses/by-sa/4.0/'],
	[/^cc0( 1\.0)?$/i, 'https://creativecommons.org/publicdomain/zero/1.0/']
];

/** licenseHref is the licence text URL of a licence name, when it is a common Creative Commons one. */
export function licenseHref(license: string): string | undefined {
	return LICENSES.find(([re]) => re.test(license.trim()))?.[1];
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
	const creditsPages: Record<number, CreditsLink[]> = {};
	const licenses: Record<number, string> = {};
	packs.forEach((p, i) => {
		const key = i + 1;
		const href = licenseHref(p.license);
		if (href) licenses[key] = href;
		if (p.license.trim().toLowerCase() !== 'per file') return;
		const base = `/api/audio-packs/${encodeURIComponent(p.packId)}/credits?limit=${PAGE}`;
		const pages = Math.max(1, Math.ceil(p.clipCount / PAGE));
		creditsPages[key] = Array.from({ length: pages }, (_, n) => ({
			label: pages === 1 ? 'Per-recording credits' : `Per-recording credits ${n * PAGE + 1}–${Math.min((n + 1) * PAGE, p.clipCount)}`,
			href: n === 0 ? base : `${base}&offset=${n * PAGE}`
		}));
	});
	return { table, creditsPages, licenseHref: licenses };
}
