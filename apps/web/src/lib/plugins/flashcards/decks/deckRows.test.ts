import { describe, expect, it } from 'vitest';

import type { EntryBase } from '$lib/api/types';
import type { Schedule } from '$lib/study/scheduler';
import type { StudyCard, StudyCardKind } from '$lib/study/types';
import { PAGE_SIZE, deckRows, filterRows, visibleCount, type RowQuery } from './deckRows';
import type { ScheduleIndex } from './deckStats';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const ALL: RowQuery = { text: '', state: 'all', kind: 'all', dueNow: false, sort: 'added' };

function card(kind: StudyCardKind, entryId: number, deckIds = ['d1'], extra: Partial<StudyCard> = {}): StudyCard {
	return {
		id: `c-${kind}-${entryId}`,
		kind,
		entryId,
		written: `w${entryId}`,
		deckIds,
		createdAt: `2026-01-01T00:00:${String(entryId % 60).padStart(2, '0')}.000Z`,
		...extra
	};
}
function sched(state: number, stability: number, due: string): Schedule {
	return { state, stability, difficulty: 5, due };
}
function base(id: number, written: string, readings: [string, string][]): EntryBase {
	return {
		id,
		language: 'zh',
		kind: 'word',
		written,
		readings: readings.map(([value, plain], ord) => ({ type: 'pinyin', value, plain, ord })),
		attrs: {},
		radicalId: null
	};
}

describe('deckRows', () => {
	it('one row per entry with a card in the deck, siblings grouped', () => {
		const cards = [
			card('vocab', 1),
			card('reverse', 1),
			card('writing', 1),
			card('vocab', 2, ['d2']),
			card('vocab', 3)
		];
		const rows = deckRows(cards, 'd1', new Map());
		expect(rows.map((r) => r.entryId)).toEqual([1, 3]);
		expect(rows[0].vocab?.id).toBe('c-vocab-1');
		expect(rows[0].siblings.map((c) => c.kind).sort()).toEqual(['reverse', 'writing']);
	});

	it('a stray sibling without a vocab card still gets a row, state New', () => {
		const rows = deckRows([card('reverse', 7)], 'd1', new Map());
		expect(rows).toHaveLength(1);
		expect(rows[0].vocab).toBeNull();
		expect(rows[0].state).toBe('new');
		expect(rows[0].score).toBe(0);
		expect(rows[0].written).toBe('w7');
	});

	it('state, score and next due come from the schedule index', () => {
		const cards = [card('vocab', 1), card('reverse', 1)];
		const index: ScheduleIndex = new Map([
			['c-vocab-1', sched(2, 200, '2026-09-01T00:00:00.000Z')],
			['c-reverse-1', sched(2, 3, '2026-03-12T00:00:00.000Z')]
		]);
		const [row] = deckRows(cards, 'd1', index);
		expect(row.state).toBe('mature');
		expect(row.score).toBe(90);
		expect(row.nextDue).toBe('2026-03-12T00:00:00.000Z');
	});

	it('lists skipped kinds of the vocab row', () => {
		const [row] = deckRows([card('vocab', 1, ['d1'], { skipKinds: ['reverse'] })], 'd1', new Map());
		expect(row.skipped).toEqual(['reverse']);
	});

	it('uses the base written form when bases are given', () => {
		const bases = new Map([[1, base(1, '好', [['hǎo', 'hao3']])]]);
		const [row] = deckRows([card('vocab', 1)], 'd1', new Map(), bases);
		expect(row.written).toBe('好');
	});
});

describe('filterRows', () => {
	const bases = new Map([
		[1, base(1, '好', [['hǎo', 'hao3']])],
		[2, base(2, 'ひらがな', [])],
		[3, base(3, '喜欢', [['xǐhuan', 'xi3huan']])]
	]);
	const cards = [card('vocab', 1), card('vocab', 2), card('vocab', 3), card('reverse', 3)];
	const index: ScheduleIndex = new Map([
		['c-vocab-1', sched(2, 30, '2026-03-09T00:00:00.000Z')],
		['c-vocab-3', sched(1, 0.3, '2026-03-20T00:00:00.000Z')]
	]);
	const rows = deckRows(cards, 'd1', index, bases);

	it('finds a word by its pinyin without tone marks', () => {
		expect(filterRows(rows, { ...ALL, text: 'hao' }, NOW).map((r) => r.entryId)).toEqual([1]);
		expect(filterRows(rows, { ...ALL, text: 'xihuan' }, NOW).map((r) => r.entryId)).toEqual([3]);
	});

	it('folds kana and finds an entry id', () => {
		expect(filterRows(rows, { ...ALL, text: 'ヒラガナ' }, NOW).map((r) => r.entryId)).toEqual([2]);
		expect(filterRows(rows, { ...ALL, text: '3' }, NOW).map((r) => r.entryId)).toContain(3);
	});

	it('filters by state, kind and due now', () => {
		expect(filterRows(rows, { ...ALL, state: 'mature' }, NOW).map((r) => r.entryId)).toEqual([1]);
		expect(filterRows(rows, { ...ALL, state: 'new' }, NOW).map((r) => r.entryId)).toEqual([2]);
		expect(filterRows(rows, { ...ALL, kind: 'reverse' }, NOW).map((r) => r.entryId)).toEqual([3]);
		expect(filterRows(rows, { ...ALL, kind: 'vocab' }, NOW)).toHaveLength(3);
		expect(filterRows(rows, { ...ALL, dueNow: true }, NOW).map((r) => r.entryId)).toEqual([1]);
	});

	it('sorts stably, ties by entry id', () => {
		expect(filterRows(rows, { ...ALL, sort: 'due' }, NOW).map((r) => r.entryId)).toEqual([1, 3, 2]);
		expect(filterRows(rows, { ...ALL, sort: 'state' }, NOW).map((r) => r.entryId)).toEqual([2, 3, 1]);
		expect(filterRows(rows, { ...ALL, sort: 'added' }, NOW).map((r) => r.entryId)).toEqual([1, 2, 3]);
	});

	it('filters 10,000 rows without folding the rows again', () => {
		const many: StudyCard[] = [];
		const manyBases = new Map<number, EntryBase>();
		for (let i = 1; i <= 10000; i++) {
			many.push(card('vocab', i));
			manyBases.set(i, base(i, `字${i}`, [['hǎo', 'hao3']]));
		}
		const big = deckRows(many, 'd1', new Map(), manyBases);
		const originalNormalize = String.prototype.normalize;
		let calls = 0;
		String.prototype.normalize = function (this: string, form?: string) {
			calls++;
			return originalNormalize.call(this, form);
		};
		try {
			const out = filterRows(big, { ...ALL, text: 'hao' }, NOW);
			expect(out).toHaveLength(10000);
		} finally {
			String.prototype.normalize = originalNormalize;
		}
		// Only the query is folded (a handful of normalize calls), never the rows.
		expect(calls).toBeLessThan(10);
	});
});

describe('visibleCount', () => {
	it('shows 100 rows per page', () => {
		expect(PAGE_SIZE).toBe(100);
		expect(visibleCount(250, 1)).toBe(100);
		expect(visibleCount(250, 2)).toBe(200);
		expect(visibleCount(250, 3)).toBe(250);
		expect(visibleCount(40, 1)).toBe(40);
		expect(visibleCount(0, 1)).toBe(0);
	});
});
