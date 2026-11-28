import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));

import { loadStudyHistory } from '$lib/studycore/data';
import { testContext, type TestContext } from '$lib/testing/context';
import * as build from '$lib/testing/study';
import { createDecksData } from './decksData.svelte';

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext();
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'w' } as never });
	vi.mocked(loadStudyHistory).mockResolvedValue(build.history({ cards: [build.card()] }));
});
afterEach(() => vi.clearAllMocks());

describe('the decks data held for the session (#290)', () => {
	it('a first load shows loading; the decks opened again show the last data at once', async () => {
		const first = createDecksData(ctx.session);
		expect(first.status).toBe('loading');
		await first.load(1);
		expect(first.status).toBe('ready');
		const again = createDecksData(ctx.session);
		expect(again.status).toBe('ready');
		expect(again.data?.cards).toHaveLength(1);
	});

	it('another workspace starts from loading', async () => {
		await createDecksData(ctx.session).load(1);
		ctx.session.workspaces.set({ list: [], current: { id: 2, language: 'zh', name: 'v' } as never });
		expect(createDecksData(ctx.session).status).toBe('loading');
	});

	it('a failed refresh keeps the data shown with a quiet notice', async () => {
		const decks = createDecksData(ctx.session);
		await decks.load(1);
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('offline'));
		await decks.load(1);
		expect(decks.status).toBe('ready');
		expect(decks.data?.cards).toHaveLength(1);
		expect(decks.stale).not.toBe('');
		await decks.load(1);
		expect(decks.stale).toBe('');
	});
});
