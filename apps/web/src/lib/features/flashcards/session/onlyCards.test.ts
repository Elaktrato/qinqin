import { describe, expect, it } from 'vitest';

import { deckSessionPlan } from './cardFlow';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { UTC_CONTEXT } from '$lib/studycore/studyContext';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';

// A session limited to some cards (#227, the mistake notebook's cards): only those cards, only when due (or new: the
// notebook lists none, every card in it has a review), and no companions.

const NOW = new Date('2026-06-01T12:00:00Z');

function card(id: string, entryId: number, kind: StudyCard['kind'] = 'vocab'): StudyCard {
	return { id, kind, entryId, written: '学习', deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' };
}

const cards: StudyCard[] = [card('c-vocab-1', 1), card('c-vocab-2', 2), card('c-vocab-3', 3), card('c-vocab-4', 4)];

function review(n: number, cardId: string, ts: string, grade: 1 | 3): ReviewEvent {
	return { id: `01JREVIEW${String(n).padStart(17, '0')}`, workspaceId: 1, device: 'web', ts, type: 'review', payload: { cardId, mode: 'vocab', grade } };
}

const reviews: ReviewEvent[] = [
	// 1 and 3: answered Again long ago, due now; 2: answered Again a moment ago (due in minutes); 4: new.
	review(1, 'c-vocab-1', '2026-01-02T00:00:00Z', 1),
	review(2, 'c-vocab-3', '2026-01-02T00:00:00Z', 1),
	review(3, 'c-vocab-2', '2026-06-01T11:59:30Z', 1)
];

function plan(onlyCards?: ReadonlySet<string>) {
	return deckSessionPlan({
		cards,
		reviews,
		now: NOW,
		w: DEFAULT_W,
		ctx: UTC_CONTEXT,
		deckIds: ['general'],
		kinds: ['vocab', 'tone', 'writing'],
		language: 'zh',
		newLimit: 20,
		reviewLimit: 200,
		studyAll: true,
		onlyCards
	});
}

describe('a deck session limited to some cards', () => {
	it('asks only the listed cards that are due, with no companions', () => {
		const limited = plan(new Set(['c-vocab-1', 'c-vocab-2']));
		expect(limited.queue.map((item) => item.cardId)).toEqual(['c-vocab-1']);
		expect(limited.reserve).toEqual([]);
	});

	it('without the limit the same session has the other due card, new cards and companions', () => {
		const all = plan().queue.map((item) => item.cardId);
		expect(all).toContain('c-vocab-3');
		expect(all).toContain('c-vocab-4');
		expect(all.length).toBeGreaterThan(3);
	});
});
