import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/show-plan.json';
import { studyDay, type ZoneChange } from '$lib/time/studyDay';
import { milestoneCard, milestoneHistory, milestonesInWeek, unseenReached, type HistoryItem } from './plan';
import type { Reached } from './reached';
import { parseSeenRows, type SeenMilestone } from './seen';

type Fixture = { id: string; reachedAt: string; reachedDay: string };
type Row = { key: string; data: unknown; deletedAt: string | null };
const reachedOf = (r: Fixture): Reached => ({ id: r.id, at: Date.parse(r.reachedAt), day: r.reachedDay });
type Case = (typeof fixture.cases)[number] & Record<string, unknown>;
const cases = fixture.cases as Case[];

describe('milestones/show-plan.json', () => {
	it.each(cases.filter((c) => c.op === 'card'))('card: $name', (c) => {
		const unseen = unseenReached((c.reached as Fixture[]).map(reachedOf), new Set(c.seen as string[]));
		const plan = milestoneCard(unseen, c.today as string);
		const want = c.expect as Record<string, unknown>;
		const got: Record<string, unknown> = { kind: plan.kind, ids: plan.kind === 'none' ? [] : plan.ids };
		if (plan.kind === 'recent') got.items = plan.items.map((r) => r.id);
		if (plan.kind === 'summary') Object.assign(got, { count: plan.count, named: plan.named.map((r) => r.id), more: plan.more });
		expect(got).toEqual(want);
	});

	it.each(cases.filter((c) => c.op === 'history'))('history: $name', (c) => {
		const items = milestoneHistory(
			(c.reached as Fixture[]).map(reachedOf),
			parseSeenRows(c.live as Row[]),
			c.pending as SeenMilestone[],
			studyDay(c.history as ZoneChange[])
		);
		expect(items).toEqual(c.expect);
	});

	it.each(cases.filter((c) => c.op === 'week'))('week: $name', (c) => {
		expect(milestonesInWeek(c.items as HistoryItem[], c.monday as string).map((i) => i.id)).toEqual(c.expect);
	});
});

describe('card plan', () => {
	const r = (id: string, day: string, hour = 9): Reached => ({ id, at: Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`), day });
	const ids = ['reviews:100', 'reviews:500', 'streak:3', 'streak:7', 'days-active:10', 'journal-entries:1'];

	it('ids always equal every unseen id; recent only with at most 3, all on or after today - 6', () => {
		const days = ['2026-11-01', '2026-11-10', '2026-11-11', '2026-11-15', '2026-11-17'];
		for (let mask = 1; mask < 64; mask++) {
			const reached = ids.filter((_, i) => mask & (1 << i)).map((id, i) => r(id, days[(mask + i) % days.length]));
			const plan = milestoneCard(unseenReached(reached, new Set()), '2026-11-17');
			if (plan.kind === 'none') throw new Error('unseen milestones and no card');
			expect([...plan.ids].sort()).toEqual(reached.map((x) => x.id).sort());
			const recent = reached.length <= 3 && reached.every((x) => x.day >= '2026-11-11');
			expect(plan.kind).toBe(recent ? 'recent' : 'summary');
			if (plan.kind === 'summary') {
				expect(plan.named).toHaveLength(Math.min(3, reached.length));
				expect(plan.more).toBe(Math.max(0, reached.length - 3));
			}
		}
	});

	it('nothing unseen is no card', () => {
		expect(milestoneCard([], '2026-11-17')).toEqual({ kind: 'none' });
	});

	it('unseenReached: newest first, seen left out', () => {
		const list = [r('reviews:100', '2026-11-01'), r('streak:3', '2026-11-03'), r('streak:7', '2026-11-08')];
		expect(unseenReached(list, new Set(['streak:3'])).map((x) => x.id)).toEqual(['streak:7', 'reviews:100']);
	});
});

describe('history', () => {
	const day = studyDay([{ zone: 'Europe/Berlin', from: null }]);

	it('pending items count as seen and keep their stored day', () => {
		const items = milestoneHistory(
			[{ id: 'reviews:100', at: Date.parse('2026-11-03T09:00:00Z'), day: '2026-11-03' }],
			new Map(),
			[{ id: 'reviews:100', seenAt: '2026-11-17T08:00:00.000Z', reachedDay: '2026-11-02' }],
			day
		);
		expect(items).toEqual([{ id: 'reviews:100', day: '2026-11-02', isNew: false }]);
	});

	it('the live row wins over a pending entry of the same id', () => {
		const live = parseSeenRows([{ key: 'milestone:streak:3', data: { reachedDay: '2026-11-05' }, deletedAt: null }]);
		const items = milestoneHistory([], live, [{ id: 'streak:3', seenAt: null, reachedDay: '2026-11-06' }], day);
		expect(items).toEqual([{ id: 'streak:3', day: '2026-11-05', isNew: false }]);
	});

	it('week items by civil date: Monday and Sunday included, the next Monday not', () => {
		const items: HistoryItem[] = ['2026-11-08', '2026-11-09', '2026-11-15', '2026-11-16'].map((d, i) => ({ id: `x${i}`, day: d, isNew: false }));
		expect(milestonesInWeek(items, '2026-11-09').map((i) => i.day)).toEqual(['2026-11-09', '2026-11-15']);
	});
});
