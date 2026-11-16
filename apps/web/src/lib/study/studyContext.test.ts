import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/scheduler/due-today.json';
import { studyDay } from '../time/studyDay';
import { buildQueue } from './scheduler';
import { dueCounts } from './dueCounts';
import { deckSessionItems } from './cardFlow';
import { buildLevelQueue } from './levelQueue';
import { previewChange } from './fsrs/preview';
import { DEFAULT_W } from './fsrs/params';
import { clockFromRuns } from './studyClock';
import { contextFor, isDueNow, UTC_CONTEXT, type StudyContext } from './studyContext';
import type { ReviewEvent, StudyCard } from './types';

const NOW = new Date('2026-06-10T12:00:00Z');
const VAC: StudyContext = { ...UTC_CONTEXT, vacationToday: true };

function ev(n: number, cardId: string, ts: string): ReviewEvent {
	return { id: `01JT${String(n).padStart(22, '0')}`, workspaceId: 1, device: 'w', ts, type: 'review', payload: { cardId, mode: 'vocab', grade: 3 } };
}
const cards: StudyCard[] = [1, 2, 3].map((n) => ({ id: `c${n}`, kind: 'vocab', entryId: n, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' }));
const reviews = [ev(1, 'c1', '2026-05-01T09:00:00Z')];

describe('fixtures: due today', () => {
	for (const c of fixture.cases) {
		it(c.name, () => {
			const ctx = { ...UTC_CONTEXT, vacationToday: c.vacationToday };
			const schedule = { due: c.due, stability: 1, difficulty: 5, state: 2 };
			expect(isDueNow(schedule, new Date(c.now), ctx)).toBe(c.isDue);
		});
	}
});

describe('a vacation day', () => {
	it('empties every queue and count', () => {
		const base = { cards, reviews, deckIds: ['general'], newLimit: 10, reviewLimit: 10, now: NOW, w: DEFAULT_W };
		expect(buildQueue({ ...base, ctx: UTC_CONTEXT }).length).toBe(3);
		expect(buildQueue({ ...base, ctx: VAC })).toEqual([]);
		expect(dueCounts({ ...base, kinds: ['vocab'], ctx: VAC })).toEqual({ due: 0, fresh: 0 });
		expect(deckSessionItems({ ...base, kinds: ['vocab', 'sentence'], language: 'zh', ctx: VAC })).toEqual([]);
		expect(buildLevelQueue({ entries: [{ id: 1, kind: 'word' }], cards, reviews, now: NOW, w: DEFAULT_W, newLimit: 5, reviewLimit: 5, ctx: VAC })).toEqual([]);
	});
	it('contextFor flags the vacation date and builds the clock from the runs', () => {
		const ctx = contextFor(studyDay([]), [{ start: '2026-06-09', end: '2026-06-11' }], NOW.getTime());
		expect(ctx.vacationToday).toBe(true);
		expect(ctx.clock.runs).toHaveLength(1);
		expect(contextFor(studyDay([]), [{ start: '2026-06-01', end: '2026-06-05' }], NOW.getTime()).vacationToday).toBe(false);
	});
});

describe('previewChange on the context', () => {
	const history = [ev(1, 'c1', '2026-05-01T09:00:00Z'), ev(2, 'c1', '2026-05-03T09:00:00Z')];
	const input = { cards, reviews: history, from: DEFAULT_W, to: DEFAULT_W, now: NOW };
	it('counts nothing due on a vacation day', () => {
		const normal = previewChange({ ...input, now: new Date('2026-09-01T00:00:00Z'), ctx: UTC_CONTEXT });
		expect(normal.dueNow[0]).toBe(1);
		expect(previewChange({ ...input, now: new Date('2026-09-01T00:00:00Z'), ctx: VAC }).dueNow).toEqual([0, 0]);
	});
	it('measures median intervals in study time (the vacation does not lengthen them)', () => {
		const clock = clockFromRuns([{ a: Date.parse('2026-05-10T00:00:00Z'), n: 20 }]);
		const plain = previewChange({ ...input, ctx: UTC_CONTEXT });
		const shifted = previewChange({ ...input, ctx: { ...UTC_CONTEXT, clock } });
		expect(shifted.medianIntervalDays[0]).toBe(plain.medianIntervalDays[0]);
	});
});

describe('guard', () => {
	const sources = import.meta.glob('/src/**/*.{ts,svelte}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
	it('UTC_CONTEXT is used by tests only', () => {
		const bad = Object.entries(sources)
			.filter(([path]) => !/\.test\.ts$|\/testing\//.test(path))
			.filter(([, text]) => text.includes('UTC_CONTEXT'))
			.map(([path]) => path)
			.filter((path) => path !== '/src/lib/study/studyContext.ts');
		expect(bad).toEqual([]);
	});
});
