// GET /api/fonts (docs/contracts/fonts/README.md): the faces of the
// installed font packs with their WOFF2 slices, and the packs' credits.
import { api, getToken } from './client';

export type FontFaceKind = 'sans' | 'serif' | 'kai';
export type FontScript = 'Hans' | 'Hant' | 'Jpan';

export interface FontSlice {
	/** `/fonts/<sha256>.woff2`, same origin, public and immutable. */
	url: string;
	/** A CSS unicode-range: `U+4E00,U+4E09-4E0B`. */
	unicodeRange: string;
}

export interface InstalledFontFace {
	packId: string;
	face: FontFaceKind;
	script: FontScript;
	/** The face the slices were cut from, as its authors name it. */
	original: string;
	/** A CSS weight or range: `400`, `200 900`. */
	weight: string;
	style: string;
	license: string;
	attribution: string;
	slices: FontSlice[];
}

export interface FontPackCredit {
	packId: string;
	name: string;
	version: string;
	license: string;
	attribution: string;
	notice: string;
}

export interface FontList {
	faces: InstalledFontFace[];
	packs: FontPackCredit[];
}

/**
 * getFonts reads GET /api/fonts. The list needs a session: signed out it
 * answers the empty list without asking (a 401 would end nothing, but
 * there is nothing to ask for).
 */
export async function getFonts(): Promise<FontList> {
	if (!getToken()) return { faces: [], packs: [] };
	return api<FontList>('/api/fonts');
}
