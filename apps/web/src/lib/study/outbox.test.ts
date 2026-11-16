import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/pwa/outbox-v2.json';
import { flushable, settle, type OutboxState } from './outbox';

describe('outbox v2 contract fixture', () => {
	for (const c of fixture.cases) {
		it(c.name, () => {
			const state = c.state as unknown as OutboxState;
			const next = settle(state, c.user, Date.parse(c.now));
			expect(next.items).toEqual(c.expect.items);
			expect(next.legacy).toEqual(c.expect.legacy);
			expect(flushable(next.items, c.user).map((i) => i.event.id)).toEqual(c.expect.flush);
		});
	}

	it('does not mutate its input', () => {
		const state: OutboxState = {
			legacy: [{ id: 'x', workspaceId: 1, ts: 't', type: 'review', device: 'web', payload: {} }],
			items: []
		};
		const copy = JSON.stringify(state);
		settle(state, 1, Date.now());
		expect(JSON.stringify(state)).toBe(copy);
	});

	it('drops another user\'s item with an unreadable queue time', () => {
		const next = settle(
			{ legacy: [], items: [{ userId: 1, queuedAt: 'garbage', event: { id: 'z', workspaceId: 1, ts: 't', type: 'review', device: 'web', payload: {} } }] },
			2,
			Date.now()
		);
		expect(next.items).toEqual([]);
	});
});
