// Bundled pictures for words (#216): GET /api/images/entries/{id} (the best
// picture of one entry) and GET /api/image-packs (the packs' credits).
// Contract: docs/contracts/images/README.md.
//
// The pictures are CC BY-SA 4.0 data of installed images packs; the server
// serves them, the web build never bundles one. The cards, the hint button and
// the visual aids (#212, #214, #215) call entryPicture and draw the svg; they
// show `pictureCreditLine(picture)` next to it.
import { api } from './client';

/** One picture with its credit, as the API sends it. */
export interface EntryPicture {
	packId: string;
	/** The picture's id in its pack (an emoji code point, a Mulberry symbol name). */
	concept: string;
	/** The picture's English name ("red apple"), for alt text. */
	label: string;
	/** Who drew it ("OpenMoji, Liz Bravo"). */
	credit: string;
	license: string;
	/** The pack's credit line ("All emojis designed by OpenMoji ..."). */
	attribution: string;
	/** How the word was matched to the picture: name, keyword, gloss, name+gloss or manual. */
	basis: string;
	/** The 1-based sense the picture shows, 0 for the whole entry. */
	sense: number;
	/** How sure the mapping is, 0-100. */
	score: number;
	/** The SVG file of the pack, unmodified. Pass it through themeSvg before inlining it. */
	svg: string;
}

/** One element of GET /api/image-packs. */
export interface ImagePackInfo {
	packId: string;
	name: string;
	version: string;
	languages: string[];
	license: string;
	attribution: string;
	notice?: string;
	pictureCount: number;
	mappingCount: number;
}

export interface EntryPictureOptions {
	/** The 1-based sense of the entry being shown: only its own and entry-wide pictures qualify. */
	sense?: number;
	signal?: AbortSignal;
}

/**
 * safeSvg returns svg when it is a plain drawing and null otherwise. The server
 * checks every picture when a pack is installed; this is the second lock on
 * the way to the page, for a server that is not ours or an old pack: an
 * element or attribute that can run code or load something is refused.
 */
export function safeSvg(svg: unknown): string | null {
	if (typeof svg !== 'string' || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) return null;
	if (/<\s*(script|foreignObject|iframe|object|embed|image|style|animate|set|a)[\s>/]/i.test(svg)) return null;
	if (/\son[a-z]+\s*=/i.test(svg) || /javascript:|data:/i.test(svg)) return null;
	if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) return null;
	return svg;
}

/**
 * entryPicture asks for the best bundled picture of a dictionary entry: null
 * when no installed images pack maps it (most words) or the picture is not a
 * plain SVG. Signed-in users only. It never throws for "no picture"; a network
 * or server error rejects like any api call, and a caller that only decorates
 * (a card) should catch it and show nothing.
 */
export async function entryPicture(entryId: number, opts: EntryPictureOptions = {}): Promise<EntryPicture | null> {
	const query = opts.sense && opts.sense > 0 ? `?sense=${Math.floor(opts.sense)}` : '';
	const body = await api<{ picture: EntryPicture | null } | null>(`/api/images/entries/${entryId}${query}`, { signal: opts.signal });
	const p = body?.picture;
	if (!p) return null;
	const svg = safeSvg(p.svg);
	return svg === null ? null : { ...p, svg };
}

/** imagePacks reads GET /api/image-packs: the installed images packs (public). */
export function imagePacks(): Promise<ImagePackInfo[]> {
	return api<ImagePackInfo[]>('/api/image-packs', { auth: false });
}

const BLACK = '(?:#000000|#000|black)';

/**
 * themeSvg makes a black-outline picture follow the theme: every black fill,
 * stroke or stop colour (attribute or style declaration) becomes currentColor,
 * so the picture takes the text colour of the element that holds it. Pictures
 * with their own colours (Mulberry) pass through unchanged. The pack's file
 * is never modified; only this copy is.
 */
export function themeSvg(svg: string): string {
	return svg
		.replace(new RegExp(`\\b(fill|stroke|stop-color)=(["'])${BLACK}\\2`, 'gi'), '$1=$2currentColor$2')
		.replace(new RegExp(`\\b(fill|stroke|stop-color)\\s*:\\s*${BLACK}(?![0-9a-f])`, 'gi'), '$1:currentColor');
}

/** pictureCreditLine is the short credit to show with a picture: "OpenMoji, Liz Bravo, CC BY-SA 4.0". */
export function pictureCreditLine(p: Pick<EntryPicture, 'credit' | 'license'>): string {
	return `${p.credit}, ${p.license}`;
}
