import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { clearUnreadableReport, rawIdentity, reportUnreadable, unreadableNotice, unreadableRows } from './unreadable';

afterEach(() => {
	clearUnreadableReport();
	vi.restoreAllMocks();
});

describe('rawIdentity', () => {
	it('reads the identity member of a row the strict decode refused', () => {
		expect(rawIdentity('cards', { id: 'c-vocab-1', kind: 'listening' })).toBe('c-vocab-1');
		expect(rawIdentity('cards', { id: 5 })).toBeNull();
		expect(rawIdentity('deckSettings', { deckId: 'd1' })).toBe('d1');
		expect(rawIdentity('limits', { deckId: null })).toBe('');
		expect(rawIdentity('limits', { deckId: 3 })).toBeNull();
		expect(rawIdentity('fsrsActive', { setId: 42 })).toBe('');
		expect(rawIdentity('decks', 'garbage')).toBeNull();
	});
});

describe('reportUnreadable', () => {
	it('keeps the last report, warns once per distinct report, and clears on a clean load', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		reportUnreadable(7, { cards: 2 }, ['cards:c-vocab-1']);
		reportUnreadable(7, { cards: 2 }, ['cards:c-vocab-1']);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(get(unreadableRows)).toEqual({ workspaceId: 7, counts: { cards: 2 }, total: 2 });
		// A clean load of another workspace leaves this workspace's report alone.
		reportUnreadable(9, {}, []);
		expect(get(unreadableRows)?.workspaceId).toBe(7);
		reportUnreadable(7, {}, []);
		expect(get(unreadableRows)).toBeNull();
	});
});

describe('unreadableNotice', () => {
	it('says how many items were left out, for the shown workspace only', () => {
		const report = { workspaceId: 7, counts: { cards: 1, decks: 1 }, total: 2 };
		expect(unreadableNotice(report, 7)).toMatch(/^2 saved study items could not be read/);
		expect(unreadableNotice({ ...report, total: 1 }, 7)).toMatch(/^1 saved study item could not be read/);
		expect(unreadableNotice(report, 9)).toBeNull();
		expect(unreadableNotice(null, 7)).toBeNull();
	});
});
