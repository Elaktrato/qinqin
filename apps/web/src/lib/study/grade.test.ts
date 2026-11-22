import { UTC_CONTEXT } from '$lib/study/studyContext';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_W } from './fsrs/params';
import { gradeItem, type GradeableItem } from './grade';
import { planCompanions } from './companions';
import { buildQueue } from './scheduler';
import type { ReviewGrade, StudyCard } from './types';

function card(id: string, entryId: number, written?: string): StudyCard {
	const result: StudyCard = {
		id,
		kind: 'vocab',
		entryId,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	};
	if (written !== undefined) result.written = written;
	return result;
}

function item(overrides: Partial<GradeableItem> = {}): GradeableItem {
	return {
		cardId: 'card-1',
		entryId: 42,
		virtual: false,
		card: card('card-1', 42, '猫'),
		...overrides
	};
}

const ENTRY = { written: '猫', sentences: [{ id: 9 }] };

describe('gradeItem for character entries', () => {
	const CHAR = { written: '学', kind: 'character', sentences: [{ id: 9 }] };

	it('creates a writing card with the entry kind and no sentence', async () => {
		const addCard = vi.fn(async () => ({ ...card('c-writing-11', 11, '学'), kind: 'writing' as const }));
		const recordReview = vi.fn(async () => {});
		const result = await gradeItem({
			item: item({ cardId: 'level:writing:11', entryId: 11, virtual: true, card: null, kind: 'writing' }),
			grade: 3,
			workspaceId: 7,
			entry: CHAR,
			addCard,
			recordReview
		});
		expect(result.ok).toBe(true);
		expect(addCard).toHaveBeenCalledWith(11, {
			kind: 'writing',
			written: '学',
			entryKind: 'character',
			deckIds: ['general'],
			sentenceId: undefined
		});
		expect(recordReview).toHaveBeenCalledWith(7, 'c-writing-11', 3, 'writing', undefined);
	});

	it('stores no sentence on a character recognition card', async () => {
		const addCard = vi.fn(async () => card('c-vocab-11', 11, '学'));
		await gradeItem({
			item: item({ cardId: 'level:11', entryId: 11, virtual: true, card: null }),
			grade: 3,
			workspaceId: 7,
			entry: CHAR,
			addCard,
			recordReview: vi.fn(async () => {})
		});
		const opts = (addCard.mock.calls[0] as unknown as [number, { sentenceId?: number }])[1];
		expect(opts.sentenceId).toBeUndefined();
		expect(opts).toMatchObject({ entryKind: 'character' });
	});
});

describe('gradeItem', () => {
	it('creates the card before recording the review for a virtual item', async () => {
		const calls: string[] = [];
		const created = card('real-1', 42, '猫');
		const addCard = vi.fn(async () => {
			calls.push('add');
			return created;
		});
		const recordReview = vi.fn(async () => {
			calls.push('record');
		});

		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 3,
			workspaceId: 7,
			entry: ENTRY,
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: true, card: created, created: true });
		expect(calls).toEqual(['add', 'record']);
		expect(addCard).toHaveBeenCalledWith(42, {
			kind: 'vocab',
			written: '猫',
			sentenceId: 9,
			deckIds: ['general']
		});
		expect(recordReview).toHaveBeenCalledWith(7, 'real-1', 3, 'vocab', undefined);
	});

	it('creates a virtual item with its own kind and sentence id and forwards mode and meta', async () => {
		const created = { ...card('real-2', 42, '猫'), kind: 'sentence' as const, sentenceId: 11 };
		const addCard = vi.fn(async () => created);
		const recordReview = vi.fn(async () => {});
		const meta = { tier: 0 as const, mistakes: 1 };

		await gradeItem({
			item: item({
				cardId: 'level:42',
				virtual: true,
				card: null,
				kind: 'sentence',
				sentenceId: 11
			}),
			grade: 3,
			workspaceId: 7,
			entry: ENTRY,
			meta,
			addCard,
			recordReview
		});

		expect(addCard).toHaveBeenCalledWith(42, {
			kind: 'sentence',
			written: '猫',
			sentenceId: 11,
			deckIds: ['general']
		});
		expect(recordReview).toHaveBeenCalledWith(7, 'real-2', 3, 'sentence', meta);
	});

	it('forwards an explicit mode and meta for a real item', async () => {
		const meta = { hints: 2 };
		const recordReview = vi.fn(async () => {});

		await gradeItem({
			item: item(),
			grade: 1,
			workspaceId: 7,
			mode: 'writing',
			meta,
			addCard: vi.fn(),
			recordReview
		});

		expect(recordReview).toHaveBeenCalledWith(7, 'card-1', 1, 'writing', meta);
	});

	it('records a real item directly without creating a card', async () => {
		const existing = card('card-1', 42, '猫');
		const addCard = vi.fn();
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: item({ card: existing }),
			grade: 2 as ReviewGrade,
			workspaceId: 7,
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: true, card: existing, created: false });
		expect(addCard).not.toHaveBeenCalled();
		expect(recordReview).toHaveBeenCalledTimes(1);
		expect(recordReview).toHaveBeenCalledWith(7, 'card-1', 2, 'vocab', undefined);
	});

	it('records nothing and reports the error when card creation fails', async () => {
		const addCard = vi.fn(async () => {
			throw new Error('network down');
		});
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 3,
			workspaceId: 7,
			entry: ENTRY,
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: false, error: 'network down' });
		expect(recordReview).not.toHaveBeenCalled();
	});

	it('reuses an existing card returned by addCard', async () => {
		const existing = card('existing-1', 42, '猫');
		const addCard = vi.fn(async () => existing);
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 4,
			workspaceId: 7,
			entry: ENTRY,
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: true, card: existing, created: true });
		expect(recordReview).toHaveBeenCalledWith(7, 'existing-1', 4, 'vocab', undefined);
	});

	it('refuses when the workspace changed mid-grade', async () => {
		const addCard = vi.fn();
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 3,
			workspaceId: 7,
			currentWorkspaceId: 8,
			entry: ENTRY,
			addCard,
			recordReview
		});

		expect(result).toEqual({
			ok: false,
			error: 'The workspace changed. Start a new session to continue.'
		});
		expect(addCard).not.toHaveBeenCalled();
		expect(recordReview).not.toHaveBeenCalled();
	});

	it('creates a companion card with its kind and written snapshot and records that mode', async () => {
		const vocab = card('v1', 42, '猫');
		const plan = { kinds: ['tone' as const], deckIds: ['general'], newBudget: 5 };
		const [companion] = planCompanions({ cards: [vocab], ...plan });
		const created = { ...card('real-9', 42, '猫'), kind: 'tone' as const };
		const addCard = vi.fn(async () => created);
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: { ...companion, card: null },
			grade: 3,
			workspaceId: 7,
			entry: { written: companion.written ?? '' },
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: true, card: created, created: true });
		expect(addCard).toHaveBeenCalledWith(42, {
			kind: 'tone',
			written: '猫',
			sentenceId: undefined,
			deckIds: ['general']
		});
		expect(recordReview).toHaveBeenCalledWith(7, 'real-9', 3, 'tone', undefined);
		expect(planCompanions({ cards: [vocab, created], ...plan })).toEqual([]);
	});

	it('never stores a sentence id on writing or tone companions', async () => {
		const addCard = vi.fn(async () => ({ ...card('real-7', 42, '猫'), kind: 'writing' as const }));
		await gradeItem({
			item: item({ cardId: 'companion:writing:42', virtual: true, card: null, kind: 'writing' }),
			grade: 3,
			workspaceId: 7,
			entry: ENTRY,
			addCard,
			recordReview: vi.fn(async () => {})
		});
		expect(addCard).toHaveBeenCalledWith(42, {
			kind: 'writing',
			written: '猫',
			sentenceId: undefined,
			deckIds: ['general']
		});
	});

	it('snapshots the entry written form for a companion planned from a card without one', async () => {
		const legacy = { ...card('v1', 42, '猫') };
		delete legacy.written;
		const [companion] = planCompanions({
			cards: [legacy],
			kinds: ['tone'],
			deckIds: ['general'],
			newBudget: 5
		});
		expect(companion.written).toBeUndefined();
		const addCard = vi.fn(async () => ({ ...card('real-3', 42, '猫'), kind: 'tone' as const }));
		await gradeItem({
			item: { ...companion, card: null },
			grade: 3,
			workspaceId: 7,
			entry: { written: '猫' },
			addCard,
			recordReview: vi.fn(async () => {})
		});
		expect(addCard).toHaveBeenCalledWith(42, {
			kind: 'tone',
			written: '猫',
			sentenceId: undefined,
			deckIds: ['general']
		});
	});

	it('creates a companion card in the deck it was planned from', async () => {
		const vocab = { ...card('v1', 42, '猫'), deckIds: ['deck-a'] };
		const plan = { kinds: ['tone' as const], deckIds: ['deck-a'], newBudget: 5 };
		const [companion] = planCompanions({ cards: [vocab], ...plan });
		const addCard = vi.fn(async (_id: number, opts: { deckIds?: string[] }) => ({
			...card('real-5', 42, '猫'),
			kind: 'tone' as const,
			deckIds: opts.deckIds ?? []
		}));

		const result = await gradeItem({
			item: { ...companion, card: null },
			grade: 3,
			workspaceId: 7,
			entry: { written: companion.written ?? '' },
			addCard,
			recordReview: vi.fn(async () => {})
		});

		expect(addCard.mock.calls[0][1].deckIds).toEqual(['deck-a']);
		if (!result.ok) throw new Error('expected ok');
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards: [vocab, result.card],
			reviews: [],
			deckIds: ['deck-a'],
			newLimit: 10,
			reviewLimit: 10,
			now: new Date(),
			kinds: ['tone']
		});
		expect(queue.map((c) => c.id)).toEqual(['real-5']);
	});

	it('waits for a still-loading entry instead of creating a card', async () => {
		const addCard = vi.fn();
		const recordReview = vi.fn(async () => {});

		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 3,
			workspaceId: 7,
			entry: null,
			addCard,
			recordReview
		});

		expect(result).toEqual({ ok: false, error: 'This word is still loading. Try again.' });
		expect(addCard).not.toHaveBeenCalled();
		expect(recordReview).not.toHaveBeenCalled();
	});
});

describe('gradeItem hands back the recorded review (#131)', () => {
	const recorded = {
		id: '01KAPZ00000000000000000001',
		workspaceId: 7,
		device: 'web',
		ts: '2026-11-22T09:00:00.000Z',
		type: 'review' as const,
		payload: { cardId: 'real-1', mode: 'vocab' as const, grade: 1 as const }
	};

	it('for a real card', async () => {
		const real = card('real-1', 42, '猫');
		const result = await gradeItem({
			item: item({ cardId: 'real-1', virtual: false, card: real }),
			grade: 1,
			workspaceId: 7,
			addCard: vi.fn(),
			recordReview: vi.fn(async () => recorded)
		});
		expect(result).toEqual({ ok: true, card: real, created: false, review: recorded });
	});

	it('for a virtual item, after creating its card', async () => {
		const created = card('real-1', 42, '猫');
		const result = await gradeItem({
			item: item({ cardId: 'level:42', virtual: true, card: null }),
			grade: 1,
			workspaceId: 7,
			entry: ENTRY,
			addCard: vi.fn(async () => created),
			recordReview: vi.fn(async () => recorded)
		});
		expect(result).toEqual({ ok: true, card: created, created: true, review: recorded });
	});
});
