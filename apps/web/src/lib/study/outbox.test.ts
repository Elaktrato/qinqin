import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/pwa/outbox-v2.json';
import { flushable, settle, type OutboxItem } from './outbox';

describe('outbox v2 contract fixture', () => {
	for (const c of fixture.cases) {
		it(c.name, () => {
			const next = settle(c.state as unknown as OutboxItem[], c.user, Date.parse(c.now));
			expect(next).toEqual(c.expect.items);
			expect(flushable(next, c.user).map((i) => i.event.id)).toEqual(c.expect.flush);
		});
	}

	it('does not mutate its input', () => {
		const state: OutboxItem[] = [
			{ userId: null, queuedAt: 't', event: { id: 'x', workspaceId: 1, ts: 't', type: 'review', device: 'web', payload: {} } }
		];
		const copy = JSON.stringify(state);
		settle(state, 1, Date.now());
		expect(JSON.stringify(state)).toBe(copy);
	});

	it('drops another user\'s item with an unreadable queue time', () => {
		const next = settle(
			[{ userId: 1, queuedAt: 'garbage', event: { id: 'z', workspaceId: 1, ts: 't', type: 'review', device: 'web', payload: {} } }],
			2,
			Date.now()
		);
		expect(next).toEqual([]);
	});
});
