import { describe, expect, it } from 'vitest';
import {
	CLAMP_NOTICE,
	ELSEWHERE_NOTICE,
	addFailure,
	neighbourAfter,
	TOO_LONG_NOTICE,
	groupSegsByRun,
	highlightKey,
	highlightKeyBusy,
	loadLastColor,
	panelGroups,
	planHighlight,
	saveLastColor,
	segmentAt
} from './highlightUi';
import { splitRunsByHighlights, type Highlight } from './highlights';
import type { Run } from './paragraphText';

function hl(id: number, paragraph: number, start: number, end: number, text = '', over: Partial<Highlight> = {}): Highlight {
	return {
		id,
		bookId: 1,
		chapter: 0,
		paragraph,
		start,
		end,
		text,
		color: 'yellow',
		note: '',
		createdAt: '2026-11-13T10:00:00Z',
		updatedAt: '2026-11-13T10:00:00Z',
		...over
	};
}

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		data
	};
}

const key = (k: string, over: Partial<Parameters<typeof highlightKey>[0]> = {}) => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	repeat: false,
	isComposing: false,
	defaultPrevented: false,
	...over
});

describe('last colour', () => {
	it('defaults to yellow and round-trips', () => {
		const s = memoryStorage();
		expect(loadLastColor(s)).toBe('yellow');
		saveLastColor(s, 'pink');
		expect(loadLastColor(s)).toBe('pink');
	});

	it('ignores unknown values and broken storage', () => {
		expect(loadLastColor(memoryStorage({ 'qinqin.reader.highlightColor': 'red' }))).toBe('yellow');
		expect(loadLastColor(null)).toBe('yellow');
		const throwing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		};
		expect(loadLastColor(throwing)).toBe('yellow');
		expect(() => saveLastColor(throwing, 'green')).not.toThrow();
	});
});

describe('highlightKey', () => {
	it('accepts a plain h (Caps Lock too)', () => {
		expect(highlightKey(key('h'), { busy: false })).toBe(true);
		expect(highlightKey(key('H'), { busy: false })).toBe(true);
	});

	it('refuses modifiers, repeats, IME, handled keys and other letters', () => {
		for (const over of [
			{ ctrlKey: true },
			{ metaKey: true },
			{ altKey: true },
			{ shiftKey: true },
			{ repeat: true },
			{ isComposing: true },
			{ defaultPrevented: true }
		]) {
			expect(highlightKey(key('h', over), { busy: false })).toBe(false);
		}
		expect(highlightKey(key('b'), { busy: false })).toBe(false);
	});

	it('refuses while something owns the keys', () => {
		expect(highlightKey(key('h'), { busy: true })).toBe(false);
	});
});

describe('highlightKeyBusy', () => {
	const el = (matches: string | null, extra: Partial<{ tagName: string; type: string }> = {}) => ({
		tagName: 'SPAN',
		...extra,
		closest: (selector: string) => (matches && selector.includes(matches) ? {} : null)
	});
	const doc = (open: boolean) => ({ querySelector: () => (open ? {} : null) });

	it('is busy in a text field', () => {
		expect(highlightKeyBusy(el(null, { tagName: 'TEXTAREA' }), doc(false), false)).toBe(true);
		expect(highlightKeyBusy(el(null, { tagName: 'INPUT', type: 'text' }), doc(false), false)).toBe(true);
	});

	it('is busy in a listbox, menu or dialog, and while one is open anywhere', () => {
		expect(highlightKeyBusy(el('listbox'), doc(false), false)).toBe(true);
		expect(highlightKeyBusy(el('dialog'), doc(false), false)).toBe(true);
		expect(highlightKeyBusy(el(null), doc(true), false)).toBe(true);
	});

	it('is not busy on plain text, a checkbox or inside the lookup popup (a dialog)', () => {
		expect(highlightKeyBusy(el(null), doc(false), false)).toBe(false);
		expect(highlightKeyBusy(el(null, { tagName: 'INPUT', type: 'checkbox' }), doc(false), false)).toBe(false);
		expect(highlightKeyBusy(el('dialog'), doc(false), true)).toBe(false);
		expect(highlightKeyBusy(null, doc(false), false)).toBe(false);
	});

	it('an open listbox elsewhere still wins over the popup exemption', () => {
		expect(highlightKeyBusy(el('dialog'), doc(true), true)).toBe(true);
	});
});

describe('planHighlight', () => {
	const text = ' 吾輩は猫である。😀名前 ';

	it('builds the body (edge whitespace trimmed by moving the offsets)', () => {
		expect(planHighlight({ p: 2, start: 0, end: 6, clamped: false }, text, 1, 'green', [])).toEqual({
			kind: 'create',
			body: { chapter: 1, paragraph: 2, start: 1, end: 6, text: '吾輩は猫で', color: 'green' },
			clamped: false
		});
	});

	it('counts astral characters as one code point', () => {
		const plan = planHighlight({ p: 0, start: 9, end: 12, clamped: false }, text, 0, 'yellow', []);
		expect(plan).toEqual({
			kind: 'create',
			body: { chapter: 0, paragraph: 0, start: 9, end: 12, text: '😀名前', color: 'yellow' },
			clamped: false
		});
	});

	it('passes the clamp on', () => {
		const plan = planHighlight({ p: 0, start: 1, end: 3, clamped: true }, text, 0, 'yellow', []);
		expect(plan.kind === 'create' && plan.clamped).toBe(true);
	});

	it('is none without a selection, paragraph or real text', () => {
		expect(planHighlight(null, text, 0, 'yellow', [])).toEqual({ kind: 'none' });
		expect(planHighlight({ p: 0, start: 0, end: 1, clamped: false }, null, 0, 'yellow', [])).toEqual({
			kind: 'none'
		});
		expect(planHighlight({ p: 0, start: 0, end: 1, clamped: false }, text, 0, 'yellow', [])).toEqual({
			kind: 'none'
		});
	});

	it('reports a selection over 500 code points', () => {
		const long = '猫'.repeat(501);
		expect(planHighlight({ p: 0, start: 0, end: 501, clamped: true }, long, 0, 'yellow', [])).toEqual({
			kind: 'tooLong',
			clamped: true
		});
	});

	it('finds an overlapping highlight of the same chapter and paragraph', () => {
		const known = [hl(7, 0, 3, 5, '猫で'), hl(8, 0, 1, 3, '吾輩', { chapter: 1 })];
		expect(planHighlight({ p: 0, start: 1, end: 4, clamped: false }, text, 0, 'pink', known)).toEqual({
			kind: 'existing',
			highlight: known[0],
			exact: false,
			clamped: false
		});
		expect(planHighlight({ p: 0, start: 3, end: 5, clamped: false }, text, 0, 'pink', known)).toEqual({
			kind: 'existing',
			highlight: known[0],
			exact: true,
			clamped: false
		});
		// Adjacent is fine; the chapter-1 highlight does not count in chapter 0.
		expect(planHighlight({ p: 0, start: 1, end: 3, clamped: false }, text, 0, 'pink', known).kind).toBe('create');
	});

	it('has readable notices', () => {
		expect(CLAMP_NOTICE).toMatch(/paragraph/);
		expect(TOO_LONG_NOTICE).toMatch(/500/);
	});
});

describe('panelGroups', () => {
	it('groups by chapter in reading order', () => {
		const items = [
			hl(1, 5, 0, 2, 'a', { chapter: 2 }),
			hl(2, 3, 4, 6, 'b'),
			hl(3, 3, 0, 2, 'c'),
			hl(4, 0, 0, 1, 'd', { chapter: 2 }),
			hl(5, 1, 0, 1, 'e')
		];
		expect(panelGroups(items).map((g) => [g.chapter, g.items.map((h) => h.id)])).toEqual([
			[0, [5, 3, 2]],
			[2, [4, 1]]
		]);
	});

	it('is empty for no highlights', () => {
		expect(panelGroups([])).toEqual([]);
	});
});

describe('segmentAt', () => {
	// Pieces of one run '漢字😀かな' cut as 漢 | 字😀 | かな (UTF-16 starts 0, 1, 4).
	const segs = [
		{ o: 0, length: 1 },
		{ o: 1, length: 3 },
		{ o: 4, length: 2 }
	];

	it('maps a run offset to the piece that starts there or holds it (start bias)', () => {
		expect(segmentAt(segs, 0, 'start')).toEqual({ index: 0, offset: 0 });
		expect(segmentAt(segs, 1, 'start')).toEqual({ index: 1, offset: 0 });
		expect(segmentAt(segs, 2, 'start')).toEqual({ index: 1, offset: 1 });
		expect(segmentAt(segs, 4, 'start')).toEqual({ index: 2, offset: 0 });
		expect(segmentAt(segs, 6, 'start')).toEqual({ index: 2, offset: 2 });
	});

	it('maps a boundary to the end of the earlier piece (end bias)', () => {
		expect(segmentAt(segs, 1, 'end')).toEqual({ index: 0, offset: 1 });
		expect(segmentAt(segs, 4, 'end')).toEqual({ index: 1, offset: 3 });
		expect(segmentAt(segs, 6, 'end')).toEqual({ index: 2, offset: 2 });
		expect(segmentAt(segs, 0, 'end')).toEqual({ index: 0, offset: 0 });
	});

	it('clamps past the end and handles a run with no pieces or an empty piece', () => {
		expect(segmentAt(segs, 99, 'start')).toEqual({ index: 2, offset: 2 });
		expect(segmentAt([], 0, 'start')).toBeNull();
		expect(segmentAt([{ o: 0, length: 0 }], 0, 'start')).toEqual({ index: 0, offset: 0 });
	});
});

describe('groupSegsByRun', () => {
	const runs: Run[] = [{ text: '吾輩' }, { text: '猫', ruby: 'ねこ' }, { text: 'である😀' }];

	it('keeps every run, its ruby once, and all of its pieces in order', () => {
		const h = hl(1, 0, 1, 4, '輩猫で');
		const groups = groupSegsByRun(splitRunsByHighlights(runs, [h]), runs.length);
		expect(groups.map((g) => [g.run, g.ruby, g.segs.map((s) => [s.text, s.startInRun, s.highlight?.id ?? null])])).toEqual([
			[0, undefined, [['吾', 0, null], ['輩', 1, 1]]],
			[1, 'ねこ', [['猫', 0, 1]]],
			[2, undefined, [['で', 0, 1], ['ある😀', 1, null]]]
		]);
	});

	it('puts the note mark on the last piece of a highlight with a note only', () => {
		const withNote = hl(1, 0, 1, 4, '輩猫で', { note: 'memo' });
		const plain = hl(2, 0, 5, 7, 'る😀');
		const groups = groupSegsByRun(splitRunsByHighlights(runs, [withNote, plain]), runs.length);
		const marks = groups.flatMap((g) => g.segs.filter((s) => s.noteMark).map((s) => s.text));
		expect(marks).toEqual(['で']);
		expect(groups.every((g) => g.segs.every((s) => !('first' in s)))).toBe(true);
	});

	it('gives an empty run an empty group entry', () => {
		const groups = groupSegsByRun(splitRunsByHighlights([{ text: '' }, { text: 'a' }], []), 2);
		expect(groups.map((g) => g.segs.length)).toEqual([1, 1]);
	});
});

describe('neighbourAfter', () => {
	const items = [
		hl(1, 2, 0, 3),
		hl(2, 5, 4, 6),
		hl(3, 0, 0, 1, '', { chapter: 1 })
	];

	it('is the next highlight in reading order after the removed place', () => {
		expect(neighbourAfter(items, { chapter: 0, paragraph: 3, start: 0 })?.id).toBe(2);
		expect(neighbourAfter(items, { chapter: 0, paragraph: 5, start: 5 })?.id).toBe(3);
		expect(neighbourAfter(items, { chapter: 0, paragraph: 0, start: 0 })?.id).toBe(1);
	});

	it('falls back to the previous one, then to null', () => {
		expect(neighbourAfter(items, { chapter: 2, paragraph: 0, start: 0 })?.id).toBe(3);
		expect(neighbourAfter([], { chapter: 0, paragraph: 0, start: 0 })).toBeNull();
	});

	it('ignores unsaved (temporary) highlights, which have no panel row to focus', () => {
		expect(neighbourAfter([hl(-1, 9, 0, 1), hl(4, 1, 0, 1)], { chapter: 0, paragraph: 5, start: 0 })?.id).toBe(4);
	});
});

describe('addFailure', () => {
	it('opens a known overlapped highlight', () => {
		expect(addFailure({ ok: false, existingId: 7, available: true }, '')).toEqual({ kind: 'existing', id: 7 });
	});

	it('explains an overlap with a highlight it cannot show', () => {
		expect(addFailure({ ok: false, existingId: 7, available: false }, '')).toEqual({ kind: 'message', text: ELSEWHERE_NOTICE });
		expect(ELSEWHERE_NOTICE).toMatch(/[Rr]eload/);
	});

	it('passes the store error on, with a fallback', () => {
		expect(addFailure({ ok: false }, 'Server error')).toEqual({ kind: 'message', text: 'Server error' });
		expect(addFailure({ ok: false }, '')).toEqual({ kind: 'message', text: 'Could not save the highlight.' });
	});
});
