import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

import { rawIdentity, unreadableNotice } from './unreadable';

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

afterEach(() => {
	ctx.session.study.unreadable.clear();
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
		ctx.session.study.unreadable.record(7, { cards: 2 }, ['cards:c-vocab-1']);
		ctx.session.study.unreadable.record(7, { cards: 2 }, ['cards:c-vocab-1']);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(ctx.session.study.unreadable.report).toEqual({ workspaceId: 7, counts: { cards: 2 }, total: 2 });
		// A clean load of another workspace leaves this workspace's report alone.
		ctx.session.study.unreadable.record(9, {}, []);
		expect(ctx.session.study.unreadable.report?.workspaceId).toBe(7);
		ctx.session.study.unreadable.record(7, {}, []);
		expect(ctx.session.study.unreadable.report).toBeNull();
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
