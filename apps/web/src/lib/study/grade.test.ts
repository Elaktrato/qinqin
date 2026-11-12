import { describe, expect, it, vi } from 'vitest';

import { gradeItem, type GradeableItem } from './grade';
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
			written: '猫',
			sentenceId: 9,
			deckIds: ['general']
		});
		expect(recordReview).toHaveBeenCalledWith(7, 'real-1', 3);
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
		expect(recordReview).toHaveBeenCalledWith(7, 'card-1', 2);
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
		expect(recordReview).toHaveBeenCalledWith(7, 'existing-1', 4);
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
