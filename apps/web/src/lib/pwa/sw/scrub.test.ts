import { describe, expect, it } from 'vitest';
import { scrubForCache } from './scrub';

const row = (pluginId: string, key: string) => ({ pluginId, key, workspaceId: 3, data: { x: 1 }, deletedAt: null });

describe('scrubForCache (#72)', () => {
	it('drops the qinqin-core lookups and lookupcfg rows from a saved pull, keeps every other row', () => {
		const body = { pluginData: [row('qinqin-core', 'lookups'), row('qinqin-core', 'lookupcfg'), row('qinqin-core', 'note:5'), row('qinqin-flashcards', 'lookups'), row('qinqin-flashcards', 'card:c-vocab-1')], pluginStates: [{ id: 'x' }], cursor: 'c' };
		const out = JSON.parse(scrubForCache('/api/sync/pull', JSON.stringify(body)) as string);
		expect(out.pluginData.map((r: { pluginId: string; key: string }) => `${r.pluginId}/${r.key}`)).toEqual([
			'qinqin-core/note:5',
			'qinqin-flashcards/lookups',
			'qinqin-flashcards/card:c-vocab-1'
		]);
		expect(out.pluginStates).toEqual([{ id: 'x' }]);
		expect(out.cursor).toBe('c');
	});

	it('drops lookup events from a saved event log', () => {
		const evs = [{ id: '1', type: 'review' }, { id: '2', type: 'lookup', payload: { query: 'ma' } }, { id: '3', type: 'view' }];
		expect(JSON.parse(scrubForCache('/api/events', JSON.stringify(evs)) as string).map((e: { id: string }) => e.id)).toEqual(['1', '3']);
	});

	it('leaves other reads byte for byte, refuses an unreadable body of a scrubbed path', () => {
		expect(scrubForCache('/api/workspaces', '[ 1 ]')).toBe('[ 1 ]');
		expect(scrubForCache('/api/sync/pull', '{oops')).toBeNull();
		expect(scrubForCache('/api/events', '{oops')).toBeNull();
		const pull = '{"pluginStates":[]}';
		expect(scrubForCache('/api/sync/pull', pull)).toBe(pull);
	});

	it('matches the decoded path', () => {
		expect(JSON.parse(scrubForCache('/api/sync%2Fpull', JSON.stringify({ pluginData: [row('qinqin-core', 'lookups')] })) as string).pluginData).toEqual([]);
		// row values are not paths: an id spelled differently is another plugin; any core key starting with lookup goes
		const out = JSON.parse(scrubForCache('/api/sync/pull', JSON.stringify({ pluginData: [row('qinqin%2Dcore', 'lookups'), row('qinqin-core', 'lookup%73')] })) as string);
		expect(out.pluginData.map((r: { pluginId: string }) => r.pluginId)).toEqual(['qinqin%2Dcore']);
	});
});
