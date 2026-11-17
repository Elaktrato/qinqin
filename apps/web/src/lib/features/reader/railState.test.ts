import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RAIL_STATE,
	RAIL_COLUMN_MIN_WIDTH,
	RAIL_TABS,
	loadRailState,
	railMode,
	saveRailState,
	nextFocusIndex,
	tabKeyTarget
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
	it('RAIL_TABS is contents, bookmarks, highlights, words, display', () => {
		expect(RAIL_TABS).toEqual(['contents', 'bookmarks', 'highlights', 'words', 'display']);
	});

	it('an old stored state {open, tab} still loads, and the new tabs load too', () => {
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":false,"tab":"words"}' }))).toEqual({ open: false, tab: 'words' });
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":true,"tab":"contents"}' }))).toEqual({ open: true, tab: 'contents' });
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":true,"tab":"display"}' }))).toEqual({ open: true, tab: 'display' });
	});

	it('an unknown tab falls back to the default', () => {
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":true,"tab":"drawer"}' })).tab).toBe(DEFAULT_RAIL_STATE.tab);
	});

	it('keeps a stored words tab', () => {
		expect(loadRailState(memoryStorage({ [KEY]: '{"open":true,"tab":"words"}' }))).toEqual({ open: true, tab: 'words' });
	});

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
	it('is a column from 1000 px and a sheet below', () => {
		expect(RAIL_COLUMN_MIN_WIDTH).toBe(1000);
		expect(railMode(1000)).toBe('column');
		expect(railMode(1280)).toBe('column');
		expect(railMode(999.5)).toBe('sheet');
		expect(railMode(999)).toBe('sheet');
		expect(railMode(390)).toBe('sheet');
		expect(railMode(0)).toBe('sheet');
	});

	it('falls back to the sheet for an unknown width', () => {
		expect(railMode(Number.NaN)).toBe('sheet');
		expect(railMode(-1)).toBe('sheet');
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

describe('nextFocusIndex (Tab wraps inside the open drawer)', () => {
	it('moves forward and wraps from the last to the first', () => {
		expect(nextFocusIndex(3, 0, false)).toBe(1);
		expect(nextFocusIndex(3, 2, false)).toBe(0);
	});

	it('moves backward with Shift and wraps from the first to the last', () => {
		expect(nextFocusIndex(3, 2, true)).toBe(1);
		expect(nextFocusIndex(3, 0, true)).toBe(2);
	});

	it('starts at an end when focus is on none of them', () => {
		expect(nextFocusIndex(3, -1, false)).toBe(0);
		expect(nextFocusIndex(3, -1, true)).toBe(2);
		expect(nextFocusIndex(3, 7, false)).toBe(0);
	});

	it('stays on the only element, and has nothing for an empty drawer', () => {
		expect(nextFocusIndex(1, 0, false)).toBe(0);
		expect(nextFocusIndex(1, 0, true)).toBe(0);
		expect(nextFocusIndex(0, -1, false)).toBeNull();
	});
});
