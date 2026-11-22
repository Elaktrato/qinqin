import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { find, put } = vi.hoisted(() => ({ find: vi.fn(), put: vi.fn() }));

vi.mock('$lib/plugins/sdk', () => ({
	createPluginSdk: () => ({ data: { user: () => ({ find, put }) } })
}));

import {
	BAR_MAX_ITEMS,
	DEFAULT_BAR,
	NAV_LAYOUT_KEY,
	PHONE_MODES,
	loadNavLayout,
	moveInBar,
	moveInBarTo,
	parseNavLayout,
	saveNavLayout,
	toggleInBar,
	withNavLayout,
	type NavLayout,
	type NavLayoutChange
} from './navLayout';

// docs/contracts/settings/nav-layout.json: the qinqin-core row "nav-layout".
const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/settings/nav-layout.json'), 'utf8')
) as {
	pluginId: string;
	key: string;
	scope: string;
	defaults: NavLayout;
	phoneModes: string[];
	maxItems: number;
	row: unknown;
	parse: { name: string; value: unknown; expect: NavLayout }[];
	write: { name: string; stored: unknown; change: NavLayoutChange; expect: unknown }[];
};

afterEach(() => {
	find.mockReset();
	put.mockReset();
});

describe('nav-layout contract', () => {
	it('names the row, the modes, the defaults and the five-item rule', () => {
		expect(fixture.pluginId).toBe('qinqin-core');
		expect(fixture.scope).toBe('user-global');
		expect(NAV_LAYOUT_KEY).toBe(fixture.key);
		expect([...PHONE_MODES]).toEqual(fixture.phoneModes);
		expect([...DEFAULT_BAR]).toEqual(fixture.defaults.bar);
		expect(BAR_MAX_ITEMS).toBe(fixture.maxItems);
		expect(parseNavLayout(null)).toEqual(fixture.defaults);
	});

	it('the example row parses as itself', () => {
		const row = fixture.row as { phone: string; bar: string[] };
		expect(parseNavLayout(fixture.row)).toEqual({ phone: row.phone, bar: row.bar });
	});

	it.each(fixture.parse.map((c) => [c.name, c] as const))('parse: %s', (_, c) => {
		expect(parseNavLayout(c.value)).toEqual(c.expect);
	});

	it.each(fixture.write.map((c) => [c.name, c] as const))('write: %s', (_, c) => {
		const before = JSON.stringify(c.stored);
		expect(withNavLayout(c.stored, c.change)).toEqual(c.expect);
		// The stored copy is never mutated.
		expect(JSON.stringify(c.stored)).toBe(before);
	});

	it('a parsed default bar is a copy (editing it never changes the defaults)', () => {
		const layout = parseNavLayout(null);
		layout.bar.push('stats');
		expect([...DEFAULT_BAR]).toEqual(fixture.defaults.bar);
	});
});

describe('bar editing (the stored list, hidden ids kept)', () => {
	const visible = ['home', 'search', 'flashcards', 'reader', 'stats'];

	it('toggleInBar appends at the end, or takes out; an id already in stays where it is', () => {
		expect(toggleInBar(['home', 'reader'], 'stats', true)).toEqual(['home', 'reader', 'stats']);
		expect(toggleInBar(['home', 'reader'], 'reader', true)).toEqual(['home', 'reader']);
		expect(toggleInBar(['home', 'journal', 'reader'], 'home', false)).toEqual(['journal', 'reader']);
	});

	it('moveInBar swaps with the next visible pin, leaving hidden ids in their slots', () => {
		// journal is switched off: it keeps slot 1.
		expect(moveInBar(['home', 'journal', 'reader'], 'reader', -1, visible)).toEqual(['reader', 'journal', 'home']);
		expect(moveInBar(['home', 'journal', 'reader'], 'home', 1, visible)).toEqual(['reader', 'journal', 'home']);
	});

	it('moveInBar is a no-op at the ends and for ids not in the bar', () => {
		expect(moveInBar(['home', 'reader'], 'home', -1, visible)).toEqual(['home', 'reader']);
		expect(moveInBar(['home', 'reader'], 'reader', 1, visible)).toEqual(['home', 'reader']);
		expect(moveInBar(['home', 'reader'], 'stats', 1, visible)).toEqual(['home', 'reader']);
	});

	it('moveInBarTo places a pin among the visible pins (clamped)', () => {
		expect(moveInBarTo(['home', 'flashcards', 'reader', 'search'], 'search', 0, visible)).toEqual([
			'search',
			'home',
			'flashcards',
			'reader'
		]);
		expect(moveInBarTo(['home', 'reader'], 'home', 9, visible)).toEqual(['reader', 'home']);
	});

	it('edits de-duplicate (the first wins) and never mutate their input', () => {
		const stored = ['home', 'reader', 'home'];
		expect(toggleInBar(stored, 'stats', true)).toEqual(['home', 'reader', 'stats']);
		expect(stored).toEqual(['home', 'reader', 'home']);
	});
});

describe('nav-layout store', () => {
	it('loadNavLayout reads the row with find (no row: the defaults)', async () => {
		find.mockResolvedValue(null);
		expect(await loadNavLayout()).toEqual(fixture.defaults);
		expect(find).toHaveBeenCalledWith('nav-layout');
	});

	it('saveNavLayout re-reads the row and changes only what it was given', async () => {
		find.mockResolvedValue({ version: 2, phone: 'bar', bar: ['stats'], other: 1 });
		put.mockResolvedValue(undefined);
		const saved = await saveNavLayout({ phone: 'drawer' });
		expect(put).toHaveBeenCalledWith('nav-layout', { version: 2, phone: 'drawer', bar: ['stats'], other: 1 });
		expect(saved).toEqual({ phone: 'drawer', bar: ['stats'] });
	});

	it('a failed read or write rejects (the caller says so)', async () => {
		find.mockRejectedValue(new Error('offline'));
		await expect(saveNavLayout({ phone: 'drawer' })).rejects.toThrow('offline');
		expect(put).not.toHaveBeenCalled();
	});
});
