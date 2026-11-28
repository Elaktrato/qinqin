import { describe, expect, it, vi } from 'vitest';
import type { StudyCard } from '$lib/studycore/types';
import { removeOwnSentence, sentenceCardIds, type RemoveDeps } from './removeSentence';

const card = (over: Partial<StudyCard>): StudyCard => ({ id: 'x', kind: 'sentence', entryId: 7, deckIds: ['general'], createdAt: '2026-11-01T00:00:00Z', ...over });

describe('sentenceCardIds (#279)', () => {
	it('picks the sentence cards of that sentence only', () => {
		const cards = [
			card({ id: 'a', sentenceId: 3 }),
			card({ id: 'b', sentenceId: 4 }),
			card({ id: 'c', kind: 'vocab', sentenceId: 3 }),
			card({ id: 'd', entryId: 8, sentenceId: 3 }),
			card({ id: 'e', kind: 'cloze', sentenceId: 3 })
		];
		expect(sentenceCardIds(cards, 7, 3)).toEqual(['a']);
	});
});

describe('removeOwnSentence (#279)', () => {
	function deps(over: Partial<RemoveDeps> = {}): RemoveDeps {
		return {
			remove: vi.fn(async () => {}),
			workspaces: [1, 2],
			cards: vi.fn(async (ws: number) => (ws === 1 ? [card({ id: 's1', sentenceId: 3 })] : [card({ id: 'other', sentenceId: 9 })])),
			deleteCards: vi.fn(async () => {}),
			...over
		};
	}

	it('deletes the sentence, then its cards in each workspace that has one', async () => {
		const d = deps();
		expect(await removeOwnSentence(d, 7, 3)).toEqual({ cardsLeft: false });
		expect(d.remove).toHaveBeenCalledWith(7, 3);
		expect(d.deleteCards).toHaveBeenCalledOnce();
		expect(d.deleteCards).toHaveBeenCalledWith(1, ['s1']);
	});

	it('a failed delete of the sentence touches no card', async () => {
		const d = deps({ remove: vi.fn(async () => Promise.reject(new Error('offline'))) });
		await expect(removeOwnSentence(d, 7, 3)).rejects.toThrow('offline');
		expect(d.cards).not.toHaveBeenCalled();
	});

	it('a workspace that fails reports cards left and the others go on', async () => {
		const d = deps({
			workspaces: [2, 1],
			cards: vi.fn(async (ws: number) => {
				if (ws === 2) throw new Error('offline');
				return [card({ id: 's1', sentenceId: 3 })];
			})
		});
		expect(await removeOwnSentence(d, 7, 3)).toEqual({ cardsLeft: true });
		expect(d.deleteCards).toHaveBeenCalledWith(1, ['s1']);
	});
});
