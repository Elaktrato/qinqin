import { describe, expect, it, vi } from 'vitest';
import type { EntryBase } from '$lib/api/types';
import type { Deck, StudyCard } from '$lib/study/types';
import { addWords, allNew, markWords } from './wordActions';
import { type StudyWrite } from '$lib/study/plan';
import { toLegacy } from '$lib/testing/legacyCodec';

const base = (id: number): EntryBase => ({ id, language: 'zh', kind: 'word', written: `w${id}`, readings: [], attrs: {}, radicalId: null });

function fakeStore(cards: StudyCard[] = [], decks: Deck[] = []) {
	const pushed: { key: string; data: unknown }[][] = [];
	const push = vi.fn(async (_ws: number, writes: readonly StudyWrite[]) => {
		// The typed writes, viewed as the legacy rows they stand for (test codec).
		const rows: { key: string; data: unknown }[] = writes.map((w) => toLegacy(w.collection, w.row));
		pushed.push([...rows]);
		for (const r of rows) {
			if (r.key.startsWith('card:')) {
				const c = r.data as StudyCard;
				const i = cards.findIndex((x) => x.id === c.id);
				if (i >= 0) cards[i] = c;
				else cards.push(c);
			}
			if (r.key.startsWith('deck:')) decks.push(r.data as Deck);
		}
	});
	const raw = vi.fn(async () => ({ decks: structuredClone(decks), cards: structuredClone(cards), knownAt: new Map<string, string>() }));
	const bases = vi.fn(async (ids: readonly number[]) => new Map(ids.filter((id) => id !== 99).map((id) => [id, base(id)])));
	return { pushed, push, raw, bases, cards };
}

const now = new Date('2026-11-16T10:00:00.000Z');
const deck: Deck = { id: 'D1', name: 'Reading', createdAt: '2026-01-01T00:00:00.000Z' };

describe('addWords', () => {
	it('a word whose card this version cannot read is still added, under another id (#167)', async () => {
		const s = fakeStore([], [deck]);
		s.raw.mockImplementation(async () => ({ decks: [deck], cards: [], knownAt: new Map<string, string>(), stored: new Map(), unreadable: new Set(['cards:c-vocab-5']) }) as never);
		const res = await addWords({ workspaceId: 3, entryIds: [5, 2], target: deck, now, ...s });
		expect(res.created).toBe(2);
		const ids = s.pushed[0].map((r) => (r.data as StudyCard).id);
		expect(ids).not.toContain('c-vocab-5');
		expect(ids).toContain('c-vocab-2');
	});

	it('creates cards in the given order (createdAt keeps the most frequent first)', async () => {
		const s = fakeStore([], [deck]);
		const res = await addWords({ workspaceId: 3, entryIds: [5, 2, 9], target: deck, now, ...s });
		expect(res).toEqual({ created: 3, joined: 0, skipped: 0, missing: 0 });
		const cards = s.pushed[0].map((r) => r.data as StudyCard);
		expect(cards.map((c) => [c.entryId, c.written, c.deckIds])).toEqual([
			[5, 'w5', ['D1']],
			[2, 'w2', ['D1']],
			[9, 'w9', ['D1']]
		]);
		expect(cards.map((c) => c.createdAt)).toEqual(['2026-11-16T10:00:00.000Z', '2026-11-16T10:00:00.001Z', '2026-11-16T10:00:00.002Z']);
		expect(s.push.mock.calls[0][0]).toBe(3);
	});

	it('a learning word joins the deck; a second identical call writes nothing', async () => {
		const learning: StudyCard = { id: 'c-vocab-2', kind: 'vocab', entryId: 2, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' };
		const s = fakeStore([learning], [deck]);
		expect(await addWords({ workspaceId: 3, entryIds: [1, 2], target: deck, now, ...s })).toEqual({ created: 1, joined: 1, skipped: 0, missing: 0 });
		expect(s.push).toHaveBeenCalledTimes(1);
		expect(await addWords({ workspaceId: 3, entryIds: [1, 2], target: deck, now, ...s })).toEqual({ created: 0, joined: 0, skipped: 2, missing: 0 });
		expect(s.push).toHaveBeenCalledTimes(1);
	});

	it('the General target writes no deck row', async () => {
		const s = fakeStore();
		await addWords({ workspaceId: 3, entryIds: [1], target: { id: 'general', name: 'General' }, now, ...s });
		expect(s.pushed[0].map((r) => r.key)).toEqual(['card:c-vocab-1']);
	});

	it('entries the server no longer has are counted missing and skipped', async () => {
		const s = fakeStore([], [deck]);
		expect(await addWords({ workspaceId: 3, entryIds: [99, 1], target: deck, now, ...s })).toEqual({ created: 1, joined: 0, skipped: 0, missing: 1 });
	});
});

describe('markWords', () => {
	it('marks the ids not marked yet; undo tombstones exactly those', async () => {
		const set = vi.fn(async () => {});
		const { written, undo } = await markWords({ workspaceId: 3, entryIds: [4, 5, 6], marked: new Set([5]), on: true, set });
		expect(written).toEqual([4, 6]);
		expect(set).toHaveBeenLastCalledWith(3, [4, 6], true);
		await undo();
		expect(set).toHaveBeenLastCalledWith(3, [4, 6], false);
	});

	it('nothing to write: no request', async () => {
		const set = vi.fn(async () => {});
		const { written } = await markWords({ workspaceId: 3, entryIds: [5], marked: new Set([5]), on: true, set });
		expect(written).toEqual([]);
		expect(set).not.toHaveBeenCalled();
	});
});

describe('allNew', () => {
	it('keeps list order and drops learning words', () => {
		expect(allNew([{ entryId: 3, state: 'new' }, { entryId: 1, state: 'learning' }, { entryId: 2, state: 'new' }])).toEqual([3, 2]);
	});
});
