import { describe, expect, it } from 'vitest';

import { normalizeUrl } from '../pwa/sw/classify';
import { firstPageUrl, nextPageUrl, pullAll } from './pager';

const REQ = ['cards', 'decks'];
const ID = '01JD8Z3Q4M5N6P7R8S9T0V1W2X';
const SCOPE = { workspaces: [{ id: 7, language: 'zh' }], languages: ['zh'], catalogue: '"k"' };

function page(over: Record<string, unknown>, cards: unknown[] = []) {
	return {
		format: 2,
		instanceId: ID,
		until: '2026-11-12T10:00:00Z',
		scope: null,
		restarted: [],
		collections: { cards, decks: [] },
		more: false,
		next: null,
		cursor: 'c2.abc',
		...over
	};
}
const card = (id: string) => ({
	workspaceId: 7, id, kind: 'vocab', entryId: 1, written: null, entryKind: null, sentenceId: null,
	skipKinds: [], deckIds: [], createdAt: '2026-11-12T08:00:00Z', extra: {}, version: 1,
	updatedAt: '2026-11-12T08:00:00Z', deletedAt: null
});

describe('urls', () => {
	it('first page: v=2, keys sorted like normalizeUrl', () => {
		const u = firstPageUrl({ collections: ['cards', 'decks'], workspace: 7, since: 'c2.x', limit: 100 });
		expect(u).toBe('/api/sync/pull?collections=cards%2Cdecks&limit=100&since=c2.x&v=2&workspace=7');
		expect(normalizeUrl(u)).toBe(u);
	});
	it('omits unset options; empty collections means all', () => {
		expect(firstPageUrl({ collections: [] })).toBe('/api/sync/pull?v=2');
	});
	it('next carries only v and page', () => {
		expect(nextPageUrl('p2.abc')).toBe('/api/sync/pull?page=p2.abc&v=2');
	});
});

describe('pullAll', () => {
	const first = () => page({ scope: SCOPE, more: true, next: 'p2.n1', cursor: null }, [card('a')]);
	it('concatenates in order and stops at more=false', async () => {
		const answers = [first(), page({}, [card('b')])];
		const asked: string[] = [];
		const out = await pullAll(async (p) => { asked.push(p); return answers.shift(); }, firstPageUrl({ collections: REQ }), REQ);
		expect(out.pages).toBe(asked.length);
		expect(asked).toEqual([firstPageUrl({ collections: REQ }), '/api/sync/pull?page=p2.n1&v=2']);
		expect((out.collections.cards as { id: string }[]).map((r) => r.id)).toEqual(['a', 'b']);
		expect(out.cursor).toBe('c2.abc');
		expect(out.scope).toEqual(SCOPE);
		expect(out.instanceId).toBe(ID);
	});
	it('throws on a page that fails to parse', async () => {
		await expect(pullAll(async () => ({ nope: 1 }), '/x', REQ)).rejects.toThrow();
	});
	it('throws past maxPages', async () => {
		const get = async () => first();
		await expect(pullAll(get, '/x', REQ, { maxPages: 3 })).rejects.toThrow(/maxPages|pages/);
	});
	it('throws when the instanceId changes mid-round', async () => {
		const answers = [first(), page({ instanceId: '01JD8Z3Q4M5N6P7R8S9T0V1W2Y' })];
		await expect(pullAll(async () => answers.shift(), '/x', REQ)).rejects.toThrow(/instance/);
	});
	it('throws when the first page has no scope', async () => {
		await expect(pullAll(async () => page({}), '/x', REQ)).rejects.toThrow();
	});
});
