// Bookmarks of a library book, as pure helpers for BookView and the
// bookmarks panel. A bookmark's position uses the reading-position format
// of position.ts ("<chapter>:<paragraph>"); its label is a short snippet
// of the paragraph it was set on, editable afterwards.
import { t } from '$lib/i18n';
import type { Bookmark } from '$lib/api/types';
import { parsePosition, type Position } from './position';

export type { Bookmark };

/** MAX_LABEL_RUNES is the server's label limit, in code points. */
export const MAX_LABEL_RUNES = 120;

/** MAX_BOOKMARKS is the server's cap per book. */
export const MAX_BOOKMARKS = 200;

const ELLIPSIS = '…';

// The characters the server drops from labels: controls other than
// whitespace, and the bidi embedding/override/isolate controls.
const DROPPED = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F‪-‮⁦-⁩]/g;

function graphemes(text: string): string[] {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		return Array.from(segmenter.segment(text), (s) => s.segment);
	}
	return Array.from(text);
}

const runeCount = (text: string) => Array.from(text).length;

/**
 * snippetAt turns a paragraph into a bookmark label: whitespace runs
 * collapsed to one space and trimmed, the characters the server would drop
 * removed, and cut to `maxRunes` code points (the ellipsis included) on a
 * grapheme boundary, so no surrogate pair or emoji sequence is split.
 */
export function snippetAt(text: string, maxRunes = MAX_LABEL_RUNES): string {
	const clean = text.replace(DROPPED, '').split(/\s+/u).filter(Boolean).join(' ');
	if (runeCount(clean) <= maxRunes) return clean;
	let out = '';
	let count = 0;
	for (const g of graphemes(clean)) {
		const n = runeCount(g);
		if (count + n > maxRunes - 1) break;
		out += g;
		count += n;
	}
	return out.trimEnd() + ELLIPSIS;
}

function samePosition(a: string, parsedB: Position | null, b: string): boolean {
	const parsedA = parsePosition(a);
	if (!parsedA || !parsedB) return a === b;
	return parsedA.chapter === parsedB.chapter && parsedA.paragraph === parsedB.paragraph;
}

/** bookmarkAt is the bookmark at exactly this position (chapter and paragraph), if any. */
export function bookmarkAt(bookmarks: Bookmark[], position: string): Bookmark | null {
	const parsed = parsePosition(position);
	return bookmarks.find((b) => samePosition(b.position, parsed, position)) ?? null;
}

/** sortForPanel orders by chapter, paragraph, then creation; malformed positions last. */
export function sortForPanel(bookmarks: Bookmark[]): Bookmark[] {
	const key = (b: Bookmark) => parsePosition(b.position);
	return [...bookmarks].sort((a, b) => {
		const pa = key(a);
		const pb = key(b);
		if (!pa || !pb) {
			if (pa) return -1;
			if (pb) return 1;
		} else if (pa.chapter !== pb.chapter) {
			return pa.chapter - pb.chapter;
		} else if (pa.paragraph !== pb.paragraph) {
			return pa.paragraph - pb.paragraph;
		}
		if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
		return a.id - b.id;
	});
}

/** bookmarkName is how a bookmark is named in the UI: its label, else its place. */
export function bookmarkName(b: Bookmark): string {
	if (b.label) return b.label;
	const p = parsePosition(b.position);
	return p ? t('reader.bookmarks.untitledChapter', { n: p.chapter + 1 }) : t('reader.bookmarks.untitled');
}

/** bookmarkedParagraphs is the set of paragraphs of `chapter` that carry a bookmark. */
export function bookmarkedParagraphs(bookmarks: Bookmark[], chapter: number): Set<number> {
	const out = new Set<number>();
	for (const b of bookmarks) {
		const p = parsePosition(b.position);
		if (p && p.chapter === chapter) out.add(p.paragraph);
	}
	return out;
}
