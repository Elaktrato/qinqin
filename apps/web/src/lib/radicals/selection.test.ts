import { describe, expect, it } from 'vitest';
import {
	entryRadicalLinks,
	selectionChips,
	typedOptions,
	statusLine,
	strokesLabel,
	togglePart,
	toggleRadical,
	toggleStrokes,
	typedSelection
} from './selection';

describe('selection edits', () => {
	it('toggles the radical, a part and the strokes', () => {
		expect(toggleRadical({ p: ['口'] }, 85)).toEqual({ r: 85, p: ['口'] });
		expect(toggleRadical({ r: 85, p: [] }, 85)).toEqual({ p: [] });
		expect(toggleRadical({ r: 85, p: [] }, 149)).toEqual({ r: 149, p: [] });
		expect(togglePart({ p: ['口'] }, '木')).toEqual({ p: ['口', '木'] });
		expect(togglePart({ r: 1, p: ['口', '木'] }, '口')).toEqual({ r: 1, p: ['木'] });
		expect(toggleStrokes({ p: [], s: 8 }, 8)).toEqual({ p: [] });
		expect(toggleStrokes({ p: [] }, 8)).toEqual({ p: [], s: 8 });
	});

	it('never keeps more than 8 parts', () => {
		const p = ['一', '二', '三', '四', '五', '六', '七', '八'];
		expect(togglePart({ p }, '九').p).toEqual(p);
	});

	it('a typed radical form selects the radical; a typed character is a part when the language has parts', () => {
		expect(typedSelection({ p: [] }, ' 氵 ', true)).toEqual({ r: 85, p: [] });
		expect(typedSelection({ p: [] }, '讠', true)).toEqual({ r: 149, p: [] });
		expect(typedSelection({ r: 85, p: [] }, '口', true)).toEqual({ r: 85, p: ['口'] });
		expect(typedSelection({ r: 85, p: [] }, '古', true)).toEqual({ r: 85, p: ['古'] });
		expect(typedSelection({ p: ['口'] }, '口', true)).toEqual({ p: ['口'] });
		// Without parts a radical's own character selects the radical.
		expect(typedSelection({ p: [] }, '口', false)).toEqual({ r: 30, p: [] });
		expect(typedSelection({ p: [] }, '古', false)).toEqual({ p: ['古'] });
		expect(typedSelection({ p: [] }, '口木', true)).toBeNull();
		expect(typedSelection({ p: [] }, '', true)).toBeNull();
	});
});

describe('labels', () => {
	it('status line', () => {
		expect(statusLine({ p: [] }, 0)).toBe('');
		expect(statusLine({ r: 1, p: [] }, 0)).toBe('No characters match.');
		expect(statusLine({ r: 1, p: [] }, 1)).toBe('1 character');
		expect(statusLine({ r: 1, p: [] }, 23)).toBe('23 characters');
	});

	it('strokes label', () => {
		expect(strokesLabel(1)).toBe('1 stroke');
		expect(strokesLabel(8)).toBe('8 strokes');
		expect(strokesLabel(0)).toBe('? strokes');
	});
});

describe('entryRadicalLinks', () => {
	it('links a character to all characters with its radical', () => {
		expect(entryRadicalLinks('語', 'character', '言')).toEqual({ withRadical: '/search/parts?r=149' });
		expect(entryRadicalLinks('语', 'character', '言')).toEqual({ withRadical: '/search/parts?r=149' });
	});

	it('a radical entry gets "browse by stroke count"', () => {
		expect(entryRadicalLinks('水', 'character', '')).toEqual({ browse: '/search/parts?r=85' });
		expect(entryRadicalLinks('水', 'character', '水')).toEqual({ withRadical: '/search/parts?r=85', browse: '/search/parts?r=85' });
	});

	it('nothing for words, forms that are no table character, or an unknown radical', () => {
		expect(entryRadicalLinks('水', 'word', '')).toEqual({});
		expect(entryRadicalLinks('氵', 'character', '')).toEqual({});
		expect(entryRadicalLinks('他', 'character', '')).toEqual({});
		expect(entryRadicalLinks('他', 'character', 'x')).toEqual({});
	});
});

describe('selectionChips', () => {
	it('lists the radical, each part and the strokes, each with the selection without it', () => {
		expect(selectionChips({ r: 85, p: ['口', '吾'], s: 8 })).toEqual([
			{ key: 'r', label: '水', name: 'radical 水 (85)', next: { p: ['口', '吾'], s: 8 } },
			{ key: 'p:口', label: '口', name: 'part 口', next: { r: 85, p: ['吾'], s: 8 } },
			{ key: 'p:吾', label: '吾', name: 'part 吾', next: { r: 85, p: ['口'], s: 8 } },
			{ key: 's', label: '8 strokes', name: '8 strokes', next: { r: 85, p: ['口', '吾'] } }
		]);
		expect(selectionChips({ p: [] })).toEqual([]);
	});
});

describe('typedOptions', () => {
	const known = new Set(['⻖', '⻏', '口']);
	const isPart = (x: string) => known.has(x);
	it('a form listed under two radicals offers both radicals and their part shapes', () => {
		expect(typedOptions({ p: [] }, '阝', isPart).map((o) => [o.name, o.next])).toEqual([
			['radical 邑 (163)', { r: 163, p: [] }],
			['radical 阜 (170)', { r: 170, p: [] }],
			['part ⻏', { p: ['⻏'] }],
			['part ⻖', { p: ['⻖'] }]
		]);
		expect(typedOptions({ p: [] }, '阝', () => false).map((o) => o.name)).toEqual(['radical 邑 (163)', 'radical 阜 (170)']);
	});
	it('anything else is the one typedSelection result', () => {
		expect(typedOptions({ p: [] }, '氵', isPart).map((o) => o.next)).toEqual([{ r: 85, p: [] }]);
		expect(typedOptions({ p: [] }, '口', isPart).map((o) => o.next)).toEqual([{ p: ['口'] }]);
		expect(typedOptions({ p: [] }, '口木', isPart)).toEqual([]);
	});
	it('the positional 阝 shapes map to their own radicals', () => {
		expect(typedOptions({ p: [] }, '⻖', () => false).map((o) => o.next)).toEqual([{ r: 170, p: [] }]);
		expect(typedOptions({ p: [] }, '⻏', () => false).map((o) => o.next)).toEqual([{ r: 163, p: [] }]);
	});
});
