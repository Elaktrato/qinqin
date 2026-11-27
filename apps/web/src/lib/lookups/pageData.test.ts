import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyCard } from '$lib/studycore/types';

const mem = vi.hoisted(() => ({ cards: new Map<string, unknown>(), pushes: 0 }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/entryBases', () => ({
	loadEntryBases: vi.fn(async (_cache: unknown, ids: readonly number[]) => new Map(ids.filter((id) => id !== 404).map((id) => [id, { id, written: `w${id}`, readings: [] }])))
}));
vi.mock('$lib/studycore/data', async (orig) => ({
	...(await orig<typeof import('$lib/studycore/data')>()),
	loadRawStudyData: vi.fn(async () => ({ decks: [], cards: [...mem.cards.values()] as StudyCard[], knownAt: new Map() }))
}));
vi.mock('$lib/studycore/commands/write', async (orig) => {
	const { cardOf } = await import('$lib/studycore/rows');
	return {
		...(await orig<typeof import('$lib/studycore/commands/write')>()),
		pushStudy: vi.fn(async (_study: unknown, _ws: number, writes: { collection: string; row: { id: string } }[]) => {
			mem.pushes++;
			for (const w of writes) if (w.collection === 'cards') mem.cards.set(`card:${w.row.id}`, cardOf(w.row as never));
		})
	};
});

import { addEntries } from './pageData';

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

beforeEach(() => {
	mem.cards.clear();
	mem.pushes = 0;
});

describe('addEntries', () => {
	it('creates one card per new word in the chosen deck; adding again creates nothing', async () => {
		const first = await addEntries(ctx.session, 3, [5, 6, 404], { id: 'general', name: 'General' }, new Date('2026-11-16T09:00:00Z'));
		expect(first).toEqual({ created: 2, joined: 0, skipped: 0, missing: 1 });
		expect([...mem.cards.keys()].sort()).toEqual(['card:c-vocab-5', 'card:c-vocab-6']);
		const again = await addEntries(ctx.session, 3, [5], { id: 'general', name: 'General' }, new Date('2026-11-16T09:01:00Z'));
		expect(again).toEqual({ created: 0, joined: 0, skipped: 1, missing: 0 });
		expect(mem.pushes).toBe(1);
	});

	it('a word with a card joins another deck', async () => {
		await addEntries(ctx.session, 3, [5], { id: 'general', name: 'General' }, new Date('2026-11-16T09:00:00Z'));
		const r = await addEntries(ctx.session, 3, [5], { id: 'd1', name: 'HSK' }, new Date('2026-11-16T09:01:00Z'));
		expect(r.joined).toBe(1);
		expect((mem.cards.get('card:c-vocab-5') as StudyCard).deckIds).toEqual(['general', 'd1']);
	});
});
