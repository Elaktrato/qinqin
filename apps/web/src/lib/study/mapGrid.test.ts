import { describe, expect, it } from 'vitest';
import type { CharRow } from '$lib/api/types';
import type { CellState } from './charGroups';
import {
	EXPAND_ALL_LIMIT,
	FIRST_BATCH,
	RENDER_BATCH,
	STAGE_INFO,
	renderedCount,
	columnCount,
	defaultOpenSections,
	filterAnnouncement,
	formatCount,
	gridMove,
	jumpGlyph,
	learnedSummary,
	locateGlyph,
	readGroupBy,
	sectionsFor,
	stageSegments,
	writeGroupBy
} from './mapGrid';

function row(i: number, c: string, extra: Partial<CharRow> = {}): CharRow {
	return { i, c, ...extra };
}

function cell(r: CharRow, score = 0): CellState {
	return { char: r, score, stage: score === 0 ? 'unknown' : 'fresh', reviewedCards: 0 };
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (index) => [...data.keys()][index] ?? null,
		removeItem: (key) => void data.delete(key),
		setItem: (key, value) => void data.set(key, String(value))
	};
}

function throwingStorage(): Storage {
	const fail = () => {
		throw new DOMException('denied', 'SecurityError');
	};
	return {
		length: 0,
		clear: fail,
		getItem: fail,
		key: fail,
		removeItem: fail,
		setItem: fail
	};
}

describe('defaultOpenSections', () => {
	it('opens every non-empty section when the total is at most the limit', () => {
		const open = defaultOpenSections([
			{ id: 'a', size: 1000 },
			{ id: 'b', size: 0 },
			{ id: 'c', size: EXPAND_ALL_LIMIT - 1000 }
		]);
		expect([...open]).toEqual(['a', 'c']);
	});

	it('opens only the first non-empty section above the limit', () => {
		const open = defaultOpenSections([
			{ id: 'a', size: 0 },
			{ id: 'b', size: 80 },
			{ id: 'c', size: EXPAND_ALL_LIMIT }
		]);
		expect([...open]).toEqual(['b']);
	});

	it('uses 1500 as the limit and handles an empty list', () => {
		expect(EXPAND_ALL_LIMIT).toBe(1500);
		expect(defaultOpenSections([]).size).toBe(0);
		expect(defaultOpenSections([{ id: 'x', size: 1500 }, { id: 'y', size: 1 }]).size).toBe(1);
	});
});

describe('gridMove', () => {
	// 10 cells in 4 columns:
	// 0 1 2 3
	// 4 5 6 7
	// 8 9
	it('moves left and right within the section, clamped at its ends', () => {
		expect(gridMove(5, 'ArrowRight', 10, 4)).toBe(6);
		expect(gridMove(3, 'ArrowRight', 10, 4)).toBe(4);
		expect(gridMove(9, 'ArrowRight', 10, 4)).toBe(9);
		expect(gridMove(4, 'ArrowLeft', 10, 4)).toBe(3);
		expect(gridMove(0, 'ArrowLeft', 10, 4)).toBe(0);
	});

	it('moves up and down by the column count', () => {
		expect(gridMove(1, 'ArrowDown', 10, 4)).toBe(5);
		expect(gridMove(5, 'ArrowDown', 10, 4)).toBe(9);
		expect(gridMove(5, 'ArrowUp', 10, 4)).toBe(1);
		expect(gridMove(2, 'ArrowUp', 10, 4)).toBe(2);
	});

	it('goes to the last cell when the row below is shorter', () => {
		expect(gridMove(7, 'ArrowDown', 10, 4)).toBe(9);
		expect(gridMove(9, 'ArrowDown', 10, 4)).toBe(9);
	});

	it('Home and End go to the row ends, with Ctrl to the section ends', () => {
		expect(gridMove(6, 'Home', 10, 4)).toBe(4);
		expect(gridMove(5, 'End', 10, 4)).toBe(7);
		expect(gridMove(8, 'End', 10, 4)).toBe(9);
		expect(gridMove(6, 'Home', 10, 4, true)).toBe(0);
		expect(gridMove(2, 'End', 10, 4, true)).toBe(9);
	});

	it('ignores other keys and treats a bad column count as one column', () => {
		expect(gridMove(2, 'Enter', 10, 4)).toBeNull();
		expect(gridMove(2, 'a', 10, 4)).toBeNull();
		expect(gridMove(2, 'ArrowDown', 10, 0)).toBe(3);
		expect(gridMove(2, 'ArrowDown', 10, Number.NaN)).toBe(3);
	});

	it('clamps an out-of-range start and handles an empty section', () => {
		expect(gridMove(42, 'ArrowLeft', 10, 4)).toBe(8);
		expect(gridMove(0, 'ArrowRight', 0, 4)).toBeNull();
	});
});

describe('columnCount', () => {
	it('counts the tracks of a computed grid-template-columns value', () => {
		expect(columnCount('41.6px 41.6px 41.6px')).toBe(3);
		expect(columnCount('  40px   40px ')).toBe(2);
	});

	it('falls back to one column', () => {
		expect(columnCount('')).toBe(1);
		expect(columnCount('none')).toBe(1);
	});
});

describe('formatCount and learnedSummary', () => {
	it('groups thousands', () => {
		expect(formatCount(13108)).toBe('13,108');
		expect(formatCount(0)).toBe('0');
	});

	it('reads "N of M learned (p %)"', () => {
		expect(learnedSummary(0, 13108)).toBe('0 of 13,108 learned (0 %)');
		expect(learnedSummary(80, 160)).toBe('80 of 160 learned (50 %)');
		expect(learnedSummary(160, 160)).toBe('160 of 160 learned (100 %)');
	});

	it('never rounds a non-zero share to 0 % or an incomplete one to 100 %', () => {
		expect(learnedSummary(3, 13108)).toBe('3 of 13,108 learned (<1 %)');
		expect(learnedSummary(1999, 2000)).toBe('1,999 of 2,000 learned (>99 %)');
	});

	it('handles an empty universe', () => {
		expect(learnedSummary(0, 0)).toBe('0 of 0 learned (0 %)');
	});
});

describe('readGroupBy and writeGroupBy', () => {
	const options = [
		{ key: 'grade' as const, label: 'Grade' },
		{ key: 'jlpt' as const, label: 'JLPT' },
		{ key: 'scheme:7' as const, label: 'My HSK' }
	];

	it('defaults to the first option', () => {
		expect(readGroupBy(memoryStorage(), 'ja', options)).toBe('grade');
	});

	it('round-trips per primary language', () => {
		const storage = memoryStorage();
		writeGroupBy(storage, 'ja', 'jlpt');
		writeGroupBy(storage, 'zh-TW', 'scheme:7');
		expect(readGroupBy(storage, 'ja', options)).toBe('jlpt');
		expect(readGroupBy(storage, 'zh', options)).toBe('scheme:7');
		expect(storage.getItem('qinqin.map.groupBy.ja')).toBe('jlpt');
	});

	it('ignores a stored key that is no longer offered', () => {
		const storage = memoryStorage({ 'qinqin.map.groupBy.ja': 'scheme:99' });
		expect(readGroupBy(storage, 'ja', options)).toBe('grade');
	});

	it('survives missing or throwing storage', () => {
		expect(readGroupBy(null, 'ja', options)).toBe('grade');
		expect(readGroupBy(throwingStorage(), 'ja', options)).toBe('grade');
		expect(() => writeGroupBy(throwingStorage(), 'ja', 'jlpt')).not.toThrow();
		expect(() => writeGroupBy(null, 'ja', 'jlpt')).not.toThrow();
	});

	it('returns null when there are no options', () => {
		expect(readGroupBy(memoryStorage(), 'es', [])).toBeNull();
	});
});

describe('jumpGlyph and locateGlyph', () => {
	const sections = [
		{ id: 'g1', cells: [cell(row(1, '日')), cell(row(2, '月'))] },
		{ id: 'g2', cells: [cell(row(3, '爱', { v: ['愛'] })), cell(row(4, '学', { v: ['學'] }))] }
	];

	it('takes the first code point of the trimmed input', () => {
		expect(jumpGlyph('  日本 ')).toBe('日');
		expect(jumpGlyph('𠮷x')).toBe('𠮷');
		expect(jumpGlyph('   ')).toBeNull();
	});

	it('finds a glyph by itself or by a variant form', () => {
		expect(locateGlyph(sections, '月')).toEqual({ sectionId: 'g1', index: 1 });
		expect(locateGlyph(sections, '學')).toEqual({ sectionId: 'g2', index: 1 });
		expect(locateGlyph(sections, '愛')).toEqual({ sectionId: 'g2', index: 0 });
	});

	it('prefers the glyph over an earlier variant match', () => {
		const tricky = [
			{ id: 'a', cells: [cell(row(1, '么', { v: ['麼'] }))] },
			{ id: 'b', cells: [cell(row(2, '麼'))] }
		];
		expect(locateGlyph(tricky, '麼')).toEqual({ sectionId: 'b', index: 0 });
	});

	it('returns null when absent', () => {
		expect(locateGlyph(sections, '火')).toBeNull();
		expect(locateGlyph([], '火')).toBeNull();
	});
});

describe('filterAnnouncement', () => {
	it('describes the result of a filter', () => {
		expect(filterAnnouncement(12, 13108, true)).toBe('12 of 13,108 characters match.');
		expect(filterAnnouncement(1, 13108, true)).toBe('1 of 13,108 characters matches.');
		expect(filterAnnouncement(0, 13108, true)).toBe('No characters match.');
		expect(filterAnnouncement(13108, 13108, false)).toBe('Showing all 13,108 characters.');
	});
});

describe('stageSegments', () => {
	it('lists the non-empty stages in order with their share', () => {
		const segments = stageSegments({ unknown: 6, fresh: 0, learning: 2, mature: 0, learned: 2 });
		expect(segments).toEqual([
			{ stage: 'unknown', count: 6, share: 60 },
			{ stage: 'learning', count: 2, share: 20 },
			{ stage: 'learned', count: 2, share: 20 }
		]);
		expect(stageSegments({ unknown: 0, fresh: 0, learning: 0, mature: 0, learned: 0 })).toEqual([]);
	});

	it('names every stage once', () => {
		expect(STAGE_INFO.map((s) => s.stage)).toEqual(['unknown', 'fresh', 'learning', 'mature', 'learned']);
		expect(STAGE_INFO[0].label).toBe('Not studied');
	});
});

describe('sectionsFor', () => {
	it('builds the grouping when its data is present', () => {
		const chars = [row(1, '日', { g: 1 }), row(2, '鬱', { g: 8 })];
		const result = sectionsFor(chars, 'grade');
		expect(result.gap).toBe(false);
		expect(result.sections.map((s) => s.label)).toEqual(['Grade 1', 'Secondary (grade 8)']);
	});

	it('falls back to one "All characters" section when the grouping lacks data', () => {
		const chars = Array.from({ length: 20 }, (_, i) => row(i + 1, String.fromCodePoint(0x4e00 + i)));
		const result = sectionsFor(chars, 'grade');
		expect(result.gap).toBe(true);
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0]).toMatchObject({ id: 'all', label: 'All characters' });
		expect(result.sections[0].chars).toHaveLength(20);
	});

	it('gives no sections for an empty universe', () => {
		expect(sectionsFor([], 'grade')).toEqual({ sections: [], gap: false });
	});
});

describe('renderedCount', () => {
	it('renders a first batch, then grows by a batch per step', () => {
		expect(FIRST_BATCH).toBeGreaterThan(0);
		expect(RENDER_BATCH).toBeGreaterThanOrEqual(FIRST_BATCH);
		expect(renderedCount(3000, 0, 0)).toBe(FIRST_BATCH);
		expect(renderedCount(3000, FIRST_BATCH, 0)).toBe(FIRST_BATCH + RENDER_BATCH);
		expect(renderedCount(3000, 2999, 0)).toBe(3000);
	});

	it('never exceeds the total and renders a small section at once', () => {
		expect(renderedCount(80, 0, 0)).toBe(80);
		expect(renderedCount(0, 0, 0)).toBe(0);
	});

	it('always includes the active cell, so it can take focus', () => {
		expect(renderedCount(10000, 0, 9000)).toBe(9001);
		expect(renderedCount(10000, FIRST_BATCH, 9999)).toBe(10000);
	});
});
