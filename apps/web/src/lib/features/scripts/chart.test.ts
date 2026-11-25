import { describe, expect, it } from 'vitest';
import { chartGroups, masteryOf } from './chart';
import { systemById } from './packs';
import { DAY, type ItemState } from './progress';

const T0 = Date.parse('2026-11-26T10:00:00Z');

describe('chart', () => {
	it('maps a state to a mastery', () => {
		expect(masteryOf(undefined)).toBe('unseen');
		expect(masteryOf({ box: 1, correct: 1, wrong: 0, lastAt: T0, dueAt: T0 })).toBe('learning');
		expect(masteryOf({ box: 3, correct: 3, wrong: 0, lastAt: T0, dueAt: T0 })).toBe('known');
	});

	it('groups the cells in the system order and marks what is known and due', () => {
		const h = systemById('hiragana')!;
		const map = new Map<string, ItemState>([['hiragana:あ', { box: 4, correct: 4, wrong: 0, lastAt: T0, dueAt: T0 - DAY }]]);
		const groups = chartGroups(h, map, T0);
		expect(groups.map((g) => g.id)).toEqual(['basic', 'dakuten', 'handakuten', 'combo']);
		expect(groups[0].cells[0]).toMatchObject({ mastery: 'known', due: true });
		expect(groups[0].cells[1]).toMatchObject({ mastery: 'unseen', due: false });
		expect(groups.reduce((n, g) => n + g.cells.length, 0)).toBe(h.items.length);
	});
});
