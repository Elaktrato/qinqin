import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../docs/contracts/reminders/plan.json';
import * as client from '../api/client';
import { fetchPlan, parsePlan, slotText } from './plan';

// docs/contracts/reminders/plan.json: the client decodes the answer shape (the computation is the server's).
describe('docs/contracts/reminders/plan.json answers', () => {
	for (const c of fixture.cases) {
		it(`decodes the slots of: ${c.name}`, () => {
			const plan = parsePlan({ generatedAt: c.now, zone: c.zone, enabled: true, channels: {}, available: {}, slots: c.expect });
			expect(plan?.slots).toEqual(c.expect);
		});
	}
});

const answer = {
	generatedAt: '2026-11-25T10:00:00Z',
	zone: 'Europe/Berlin',
	enabled: true,
	channels: { email: false, push: false, device: true },
	available: { email: false, push: true },
	slots: [{ id: 200541, kind: 'due', at: '2026-11-25T17:00:00Z', local: '2026-11-25T18:00', day: '2026-11-25', count: 15 }]
};

describe('parsePlan', () => {
	it('reads the documented answer', () => {
		expect(parsePlan(answer)).toEqual(answer);
	});
	it('tolerates unknown fields, and drops slots of an unknown kind or off shape', () => {
		const plan = parsePlan({
			...answer,
			future: 1,
			slots: [
				{ ...answer.slots[0], extra: true },
				{ ...answer.slots[0], kind: 'newkind' },
				{ ...answer.slots[0], at: 'soon' },
				{ ...answer.slots[0], id: 1.5 },
				null,
				{ id: 7, kind: 'goal', at: '2026-11-25T17:00:00Z', local: '2026-11-25T18:00', day: '2026-11-25', count: null }
			]
		});
		expect(plan?.slots.map((s) => s.id)).toEqual([200541, 7]);
		expect(plan?.slots[1].count).toBeNull();
	});
	it('reads missing members as off', () => {
		expect(parsePlan({ slots: [] })).toMatchObject({ enabled: false, channels: { email: false, push: false, device: false }, available: { email: false, push: false }, slots: [] });
	});
	it('is null for what is not an object', () => {
		for (const raw of [null, 'x', 3, [], undefined]) expect(parsePlan(raw)).toBeNull();
	});
});

describe('fetchPlan', () => {
	afterEach(() => vi.restoreAllMocks());
	it('asks for the days, clamped to 1..14', async () => {
		const spy = vi.spyOn(client, 'api').mockResolvedValue(answer);
		await fetchPlan(7);
		await fetchPlan(99);
		await fetchPlan(0);
		expect(spy.mock.calls.map((c) => c[0])).toEqual(['/api/reminders/plan?days=7', '/api/reminders/plan?days=14', '/api/reminders/plan?days=1']);
	});
	it('rejects an answer that is not a plan', async () => {
		vi.spyOn(client, 'api').mockResolvedValue('nope');
		await expect(fetchPlan(3)).rejects.toThrow();
	});
});

describe('slotText', () => {
	const slot = (kind: 'due' | 'goal' | 'streak', count: number | null) => ({ id: 1, kind, at: '', local: '', day: '', count });
	it('maps a slot to its catalogue keys and count', () => {
		expect(slotText(slot('due', 15))).toEqual({
			titleKey: 'settings.reminders.notify.due.title',
			bodyKey: 'settings.reminders.notify.due.body',
			count: 15
		});
		expect(slotText(slot('goal', null))).toMatchObject({ titleKey: 'settings.reminders.notify.goal.title', count: 0 });
		expect(slotText(slot('streak', 5))).toMatchObject({ bodyKey: 'settings.reminders.notify.streak.body', count: 5 });
	});
});
