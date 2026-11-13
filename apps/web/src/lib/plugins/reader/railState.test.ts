import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RAIL_STATE,
	RAIL_COLUMN_MIN_WIDTH,
	loadRailState,
	railMode,
	saveRailState,
	tabKeyTarget,
	topParagraph
} from './railState';

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		data
	};
}

const throwing = {
	getItem: (): string | null => {
		throw new Error('blocked');
	},
	setItem: (): void => {
		throw new Error('blocked');
	}
};

const KEY = 'qinqin.reader.rail';

describe('rail state', () => {
	it('defaults to an open rail on the bookmarks tab', () => {
		expect(DEFAULT_RAIL_STATE).toEqual({ open: true, tab: 'bookmarks' });
		expect(loadRailState(memoryStorage())).toEqual(DEFAULT_RAIL_STATE);
	});

	it('round-trips a saved state', () => {
		const storage = memoryStorage();
		saveRailState(storage, { open: false, tab: 'highlights' });
		expect(JSON.parse(storage.data.get(KEY) ?? '')).toEqual({ open: false, tab: 'highlights' });
		expect(loadRailState(storage)).toEqual({ open: false, tab: 'highlights' });
	});

	it('ignores corrupted or invalid stored values field by field', () => {
		expect(loadRailState(memoryStorage({ [KEY]: '{nope' }))).toEqual(DEFAULT_RAIL_STATE);
		expect(loadRailState(memoryStorage({ [KEY]: 'null' }))).toEqual(DEFAULT_RAIL_STATE);
		expect(loadRailState(memoryStorage({ [KEY]: '42' }))).toEqual(DEFAULT_RAIL_STATE);
		expect(loadRailState(memoryStorage({ [KEY]: '[true,"highlights"]' }))).toEqual(DEFAULT_RAIL_STATE);
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":"no","tab":"highlights"}' }))).toEqual({
			open: true,
			tab: 'highlights'
		});
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":false,"tab":"notes"}' }))).toEqual({
			open: false,
			tab: 'bookmarks'
		});
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":false,"tab":"__proto__"}' }))).toEqual({
			open: false,
			tab: 'bookmarks'
		});
	});

	it('works without storage or when storage throws', () => {
		expect(loadRailState(null)).toEqual(DEFAULT_RAIL_STATE);
		expect(loadRailState(throwing)).toEqual(DEFAULT_RAIL_STATE);
		expect(() => saveRailState(throwing, DEFAULT_RAIL_STATE)).not.toThrow();
		expect(() => saveRailState(null, DEFAULT_RAIL_STATE)).not.toThrow();
	});

	it('returns a fresh object each time (callers may mutate it)', () => {
		const a = loadRailState(null);
		a.open = false;
		expect(loadRailState(null)).toEqual(DEFAULT_RAIL_STATE);
		expect(DEFAULT_RAIL_STATE.open).toBe(true);
	});
});

describe('railMode', () => {
	it('is a column from 1000 px and a drawer below', () => {
		expect(RAIL_COLUMN_MIN_WIDTH).toBe(1000);
		expect(railMode(1000)).toBe('column');
		expect(railMode(1280)).toBe('column');
		expect(railMode(999.5)).toBe('drawer');
		expect(railMode(999)).toBe('drawer');
		expect(railMode(390)).toBe('drawer');
		expect(railMode(0)).toBe('drawer');
	});

	it('falls back to the drawer for an unknown width', () => {
		expect(railMode(Number.NaN)).toBe('drawer');
		expect(railMode(-1)).toBe('drawer');
	});
});

describe('tabKeyTarget (roving tabindex of a vertical tab list)', () => {
	it('moves down and up with wrap-around', () => {
		expect(tabKeyTarget('ArrowDown', 0, 2)).toBe(1);
		expect(tabKeyTarget('ArrowDown', 1, 2)).toBe(0);
		expect(tabKeyTarget('ArrowUp', 0, 2)).toBe(1);
		expect(tabKeyTarget('ArrowUp', 1, 2)).toBe(0);
	});

	it('also accepts left and right arrows', () => {
		expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
		expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
	});

	it('jumps to the ends with Home and End', () => {
		expect(tabKeyTarget('Home', 2, 3)).toBe(0);
		expect(tabKeyTarget('End', 0, 3)).toBe(2);
	});

	it('ignores other keys and an empty list', () => {
		expect(tabKeyTarget('Enter', 0, 2)).toBeNull();
		expect(tabKeyTarget('b', 0, 2)).toBeNull();
		expect(tabKeyTarget('ArrowDown', 0, 0)).toBeNull();
	});
});

describe('topParagraph (first paragraph in view)', () => {
	const entry = (p: number, isIntersecting: boolean) => ({
		isIntersecting,
		target: { dataset: { p: String(p) } }
	});

	it('tracks the smallest intersecting paragraph across batches', () => {
		const visible = new Set<number>();
		expect(topParagraph(visible, [entry(3, true), entry(4, true), entry(5, true)])).toBe(3);
		expect(topParagraph(visible, [entry(3, false), entry(6, true)])).toBe(4);
		expect(topParagraph(visible, [entry(2, true)])).toBe(2);
	});

	it('returns null while nothing is in view, keeping the last place to the caller', () => {
		const visible = new Set<number>();
		expect(topParagraph(visible, [entry(1, true)])).toBe(1);
		expect(topParagraph(visible, [entry(1, false)])).toBeNull();
	});

	it('ignores targets without a paragraph index', () => {
		const visible = new Set<number>();
		const stray = { isIntersecting: true, target: { dataset: {} } };
		expect(topParagraph(visible, [stray, entry(7, true)])).toBe(7);
		expect(visible.size).toBe(1);
	});
});
