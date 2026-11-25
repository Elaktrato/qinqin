import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadRawStudyData: vi.fn()
}));
vi.mock('$lib/study/commands/write', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/write')>()),
	pushStudy: vi.fn()
}));

import { loadRawStudyData } from '$lib/study/data';
import { pushStudy } from '$lib/study/commands/write';
import { addDeckFromOverview } from './addDeckFromOverview';

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

const raw = () => ({
	decks: [],
	cards: [],
	knownAt: new Map(),
	stored: new Map(),
	deckSettings: {}
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(loadRawStudyData).mockResolvedValue(raw() as never);
	vi.mocked(pushStudy).mockResolvedValue(undefined);
});

describe('addDeckFromOverview', () => {
	it('creates the owned deck and its first card in one push', async () => {
		const plan = await addDeckFromOverview(ctx.session.study, {
			workspaceId: 2,
			items: [{ entryId: 7, written: '学习' }],
			target: { id: 'd-lvl-test', name: 'HSK 3.0 · HSK 1' }
		});
		expect(plan.created).toBe(1);
		expect(plan.deck?.id).toBe('d-lvl-test');
		expect(vi.mocked(pushStudy)).toHaveBeenCalledOnce();
		const [, workspace, rows] = vi.mocked(pushStudy).mock.calls[0];
		expect(workspace).toBe(2);
		expect(rows).toHaveLength(2); // the deck row and the card
	});

	it('leaves known words out for a starter deck and can add nothing new', async () => {
		const plan = await addDeckFromOverview(ctx.session.study, {
			workspaceId: 2,
			items: [
				{ entryId: 7, written: '学习' },
				{ entryId: 8, written: '朋友' }
			],
			target: { id: 'd-frq-test', name: 'Jiten · Top 500' },
			exclude: new Set([7])
		});
		expect(plan.created).toBe(1);
		expect(plan.known).toBe(1);
		expect(vi.mocked(pushStudy)).toHaveBeenCalledOnce();
	});
});
