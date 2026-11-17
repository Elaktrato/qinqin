// Pure glue between the reader's DOM and the highlights: the remembered
// colour, the `h` shortcut, what a selection turns into, the panel's
// grouping and the segment mapping ChapterText and dom.ts share.
import { labelRecord, t, type MessageKey } from '$lib/i18n';
import type { NewHighlight } from '$lib/api/library';
import { WIDGET_SELECTOR, OPEN_WIDGET_SELECTOR, isTextEntry, type KeyLike } from './bookmarkList.svelte';
import {
	buildHighlightBody,
	isHighlightColor,
	overlaps,
	type Highlight,
	type HighlightColor,
	type Seg
} from './highlights';
import type { PrefsStorage } from './prefs';

export { segmentAt } from './paragraphText';

const COLOR_KEY = 'qinqin.reader.highlightColor';

/**
 * HighlightActions is what the selection popup's action bar needs from
 * the reader: the colour a new highlight gets, whether highlighting works
 * now, a short notice about the last attempt, and the two actions.
 */
export interface HighlightActions {
	readonly color: HighlightColor;
	readonly ready: boolean;
	readonly notice: string;
	pick(color: HighlightColor): void;
	note(): void;
}

export const COLOR_NAMES: Readonly<Record<HighlightColor, string>> = labelRecord({
	yellow: 'reader.highlights.color.yellow',
	green: 'reader.highlights.color.green',
	blue: 'reader.highlights.color.blue',
	pink: 'reader.highlights.color.pink'
});

/** "Highlight in yellow": the swatch buttons of the highlight bar. */
export const HIGHLIGHT_IN: Readonly<Record<HighlightColor, MessageKey>> = {
	yellow: 'reader.highlights.in.yellow',
	green: 'reader.highlights.in.green',
	blue: 'reader.highlights.in.blue',
	pink: 'reader.highlights.in.pink'
};

/** loadLastColor: the colour picked last in this browser, yellow by default. */
export function loadLastColor(storage: PrefsStorage | null): HighlightColor {
	try {
		const value = storage?.getItem(COLOR_KEY);
		return isHighlightColor(value) ? value : 'yellow';
	} catch {
		return 'yellow';
	}
}

export function saveLastColor(storage: PrefsStorage | null, color: HighlightColor): void {
	try {
		storage?.setItem(COLOR_KEY, color);
	} catch {
		// A convenience only: the colour still applies for this visit.
	}
}

/**
 * highlightKey says whether a keydown is the highlight shortcut: a plain
 * `h` (Caps Lock allowed, no modifiers, not held, not part of an IME
 * composition, not handled already) while nothing else owns the keys.
 * Unlike `b`, an open lookup popup does not block it: selecting text opens
 * one, and highlighting that selection is the point.
 */
export function highlightKey(e: KeyLike, ctx: { busy: boolean }): boolean {
	if (e.key !== 'h' && e.key !== 'H') return false;
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
	if (e.repeat || e.isComposing || e.defaultPrevented) return false;
	return !ctx.busy;
}

type KeyTarget = { tagName: string; type?: string; isContentEditable?: boolean; closest(selector: string): unknown };

/**
 * highlightKeyBusy: the `b` key's guard (a text field, a focused listbox,
 * menu or dialog, an open listbox or menu anywhere) except that the lookup
 * popup, a non-modal dialog, does not count: focus is often on one of its
 * buttons after picking a colour.
 */
export function highlightKeyBusy(
	target: KeyTarget | null,
	doc: { querySelector(selector: string): unknown } | null,
	inLookupPopup: boolean
): boolean {
	if (isTextEntry(target)) return true;
	if (target && !inLookupPopup && target.closest(WIDGET_SELECTOR)) return true;
	return !!doc && !!doc.querySelector(OPEN_WIDGET_SELECTOR);
}

/** A selection mapped to one paragraph (code points); `clamped` when it went on past it. */
export interface ParagraphSpan {
	p: number;
	start: number;
	end: number;
	clamped: boolean;
}

export type HighlightPlan =
	| { kind: 'none' }
	| { kind: 'tooLong'; clamped: boolean }
	| { kind: 'existing'; highlight: Highlight; exact: boolean; clamped: boolean }
	| { kind: 'create'; body: NewHighlight; clamped: boolean };

export function clampNotice(): string {
	return t('reader.highlights.clamp');
}
export function tooLongNotice(): string {
	return t('reader.highlights.tooLong');
}
export function elsewhereNotice(): string {
	return t('reader.highlights.elsewhere');
}
export function overlapNotice(): string {
	return t('reader.highlights.overlap');
}

/**
 * planHighlight: what highlighting a selection does. Nothing for an empty
 * or whitespace-only selection; `tooLong` past 500 code points; `existing`
 * when the (trimmed) span overlaps a known highlight of this chapter and
 * paragraph (`exact` when it is the same span); otherwise the body to
 * create, built with buildHighlightBody.
 */
export function planHighlight(
	selection: ParagraphSpan | null,
	paragraphText: string | null,
	chapter: number,
	color: HighlightColor,
	known: Highlight[]
): HighlightPlan {
	if (!selection || paragraphText === null) return { kind: 'none' };
	const built = buildHighlightBody(paragraphText, selection.start, selection.end, color);
	if (!built) return { kind: 'none' };
	const clamped = selection.clamped;
	if (built.tooLong) return { kind: 'tooLong', clamped };
	const { start, end } = built.body;
	const hit = overlaps(known, selection.p, start, end, chapter);
	if (hit) return { kind: 'existing', highlight: hit, exact: hit.start === start && hit.end === end, clamped };
	return { kind: 'create', body: { chapter, paragraph: selection.p, ...built.body }, clamped };
}

/** panelGroups: the highlights per chapter, chapters and items in reading order. */
export function panelGroups(items: Highlight[]): { chapter: number; items: Highlight[] }[] {
	const sorted = [...items].sort(
		(a, b) => a.chapter - b.chapter || a.paragraph - b.paragraph || a.start - b.start || a.id - b.id
	);
	const groups: { chapter: number; items: Highlight[] }[] = [];
	for (const h of sorted) {
		const last = groups[groups.length - 1];
		if (last && last.chapter === h.chapter) last.items.push(h);
		else groups.push({ chapter: h.chapter, items: [h] });
	}
	return groups;
}

export interface RunPiece extends Seg {
	/** The last piece of a highlight that has a note: shows the note dot. */
	noteMark: boolean;
}

/**
 * groupSegsByRun regroups splitRunsByHighlights' pieces per run (ruby
 * stays with its run, so all pieces sit under one <ruby> with the <rt>
 * after them) and marks the last piece of each highlight with a note.
 */
export function groupSegsByRun(
	segs: Seg[],
	runCount: number
): { run: number; ruby?: string; segs: RunPiece[] }[] {
	const groups: { run: number; ruby?: string; segs: RunPiece[] }[] = [];
	for (let r = 0; r < runCount; r++) groups.push({ run: r, segs: [] });
	segs.forEach((seg, i) => {
		const group = groups[seg.run];
		if (!group) return;
		if (seg.ruby !== undefined) group.ruby = seg.ruby;
		const h = seg.highlight;
		const next = segs[i + 1]?.highlight ?? null;
		group.segs.push({
			...seg,
			noteMark: h !== null && h.note.trim() !== '' && next?.id !== h.id
		});
	});
	return groups;
}

const readingOrder = (a: { chapter: number; paragraph: number; start: number }, b: typeof a) =>
	a.chapter - b.chapter || a.paragraph - b.paragraph || a.start - b.start;

/**
 * neighbourAfter: where focus goes in the panel after a highlight at
 * `place` was removed: the next saved highlight in reading order, else the
 * last one before it, else null.
 */
export function neighbourAfter(
	items: Highlight[],
	place: { chapter: number; paragraph: number; start: number }
): Highlight | null {
	const saved = items.filter((h) => h.id > 0).sort((a, b) => readingOrder(a, b) || a.id - b.id);
	return saved.find((h) => readingOrder(h, place) > 0) ?? saved[saved.length - 1] ?? null;
}

/**
 * addFailure: what to do when adding a highlight was refused: open the
 * overlapped highlight when it is known here, otherwise say why.
 */
export function addFailure(
	result: { ok: false; existingId?: number; available?: boolean },
	storeError: string
): { kind: 'existing'; id: number } | { kind: 'message'; text: string } {
	if (result.existingId !== undefined) {
		return result.available ? { kind: 'existing', id: result.existingId } : { kind: 'message', text: elsewhereNotice() };
	}
	return { kind: 'message', text: storeError || t('reader.error.highlight') };
}
