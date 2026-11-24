import { describe, expect, it } from 'vitest';
import { scrubForCache } from './scrub';

const row = (key: string) => ({ key, workspaceId: 3, data: { x: 1 }, deletedAt: null });

describe('scrubForCache (#72)', () => {
	it('drops the lookup rows from every v2 page, first or continuation, and keeps every other row', () => {
		const page = (rows: unknown[], extra: object = {}) => ({
			format: 2,
			until: '2026-11-17T00:00:00Z',
			collections: { pluginStates: [{ pluginId: 'x' }], rows, cards: [] },
			more: false,
			next: null,
			cursor: 'c2.x',
			...extra
		});
		const body = page([row('lookups'), row('lookupcfg'), row('note:5'), row('goals:workspace')]);
		const out = JSON.parse(scrubForCache('/api/sync/pull', JSON.stringify(body)) as string);
		expect(out.collections.rows.map((r: { key: string }) => r.key)).toEqual(['note:5', 'goals:workspace']);
		expect(out.collections.pluginStates).toEqual([{ pluginId: 'x' }]);
		expect(out.cursor).toBe('c2.x');
		expect(out.more).toBe(false);
		const clean = JSON.stringify(page([row('note:5')]));
		expect(scrubForCache('/api/sync/pull', clean)).toBe(clean);
		// a v2 page without rows (cards only) is kept byte for byte
		const cards = JSON.stringify({ format: 2, collections: { cards: [] } });
		expect(scrubForCache('/api/sync/pull', cards)).toBe(cards);
		// a body that is no page is kept as it is
		const other = JSON.stringify({ rows: [row('lookups')] });
		expect(scrubForCache('/api/sync/pull', other)).toBe(other);
	});

	it('drops lookup events from a saved event log', () => {
		const evs = [{ id: '1', type: 'review' }, { id: '2', type: 'lookup', payload: { query: 'ma' } }, { id: '3', type: 'view' }];
		expect(JSON.parse(scrubForCache('/api/events', JSON.stringify(evs)) as string).map((e: { id: string }) => e.id)).toEqual(['1', '3']);
	});

	it('drops lookup events from a saved page of the event log (#110)', () => {
		const page = { events: [{ id: '1', type: 'review' }, { id: '2', type: 'lookup', payload: { query: 'ma' } }], more: true, next: 'e1.x' };
		expect(JSON.parse(scrubForCache('/api/events', JSON.stringify(page)) as string)).toEqual({ events: [{ id: '1', type: 'review' }], more: true, next: 'e1.x' });
		const clean = JSON.stringify({ events: [{ id: '1', type: 'review' }], more: false, next: null });
		expect(scrubForCache('/api/events', clean)).toBe(clean);
		expect(scrubForCache('/api/events', JSON.stringify({ events: 'x', more: false, next: null }))).toBeNull();
		expect(scrubForCache('/api/events', JSON.stringify({ more: false }))).toBeNull();
	});

	it('leaves other reads byte for byte, refuses an unreadable body of a scrubbed path', () => {
		expect(scrubForCache('/api/workspaces', '[ 1 ]')).toBe('[ 1 ]');
		expect(scrubForCache('/api/sync/pull', '{oops')).toBeNull();
		expect(scrubForCache('/api/events', '{oops')).toBeNull();
		const pull = '{"pluginStates":[]}';
		expect(scrubForCache('/api/sync/pull', pull)).toBe(pull);
	});

	it('matches the decoded path; row keys are values, not paths', () => {
		const page = (rows: unknown[]) => JSON.stringify({ format: 2, collections: { rows } });
		expect(JSON.parse(scrubForCache('/api/sync%2Fpull', page([row('lookups')])) as string).collections.rows).toEqual([]);
		// any key starting with lookup goes, spelled as it is
		expect(JSON.parse(scrubForCache('/api/sync/pull', page([row('lookup%73'), row('note:1')])) as string).collections.rows.map((r: { key: string }) => r.key)).toEqual(['note:1']);
	});
});
