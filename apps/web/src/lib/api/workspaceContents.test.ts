import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { fetchWorkspaceContents } from './workspaceContents';
import { pagedPull } from '$lib/testing/legacyCodec';

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('fetchWorkspaceContents', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function row(key: string, data: unknown, over: Record<string, unknown> = {}) {
		return { pluginId: 'qinqin-flashcards', key, workspaceId: 7, data, deletedAt: null, ...over };
	}
	function card(id: string, entryId: number, createdAt: string) {
		return { id, kind: 'vocab', entryId, deckIds: ['general'], createdAt };
	}
	function review(id: string, cardId: string, workspaceId = 7) {
		return { id, workspaceId, device: 'web', ts: '2026-02-01T00:00:00.000Z', type: 'review', payload: { cardId, mode: 'vocab', grade: 3 } };
	}

	it('counts the books, merged cards, decks and reviews of one workspace', async () => {
		const a = card('01JAAAAAAAAAAAAAAAAAAAAAAA', 42, '2026-01-01T00:00:00Z');
		// The same word added on a second device before card ids were
		// deterministic: one card, as every study page shows it.
		const aDup = card('01JBBBBBBBBBBBBBBBBBBBBBBB', 42, '2026-01-02T00:00:00Z');
		const b = card('01JCCCCCCCCCCCCCCCCCCCCCCC', 43, '2026-01-03T00:00:00Z');
		const gone = card('01JDDDDDDDDDDDDDDDDDDDDDDD', 44, '2026-01-04T00:00:00Z');
		const other = card('01JEEEEEEEEEEEEEEEEEEEEEEE', 45, '2026-01-05T00:00:00Z');
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url === '/api/library/books?workspace=7') return jsonResponse([{ id: 1 }, { id: 2 }]);
			if (url.startsWith('/api/sync/pull')) {
				return jsonResponse(pagedPull({
					pluginData: [
						row(`card:${a.id}`, a),
						row(`card:${aDup.id}`, aDup),
						row(`card:${b.id}`, b),
						row(`card:${gone.id}`, gone, { deletedAt: '2026-01-06T00:00:00Z' }),
						row('deck:d', { id: 'd', name: 'D', createdAt: '2026-01-01T00:00:00Z' }),
						row(`card:${other.id}`, other, { workspaceId: 3 }),
						row(`card:${other.id}`, other, { pluginId: 'other' })
					]
				}));
			}
			if (url.startsWith('/api/events') && url.endsWith('workspace=7')) {
				return jsonResponse([
					review('r1', a.id),
					review('r2', aDup.id),
					review('r3', b.id),
					{ ...review('s1', b.id), type: 'session', payload: {} }
				]);
			}
			return new Response('unexpected', { status: 500 });
		});

		await expect(fetchWorkspaceContents(ctx.session.study, 7)).resolves.toEqual({ books: 2, cards: 2, decks: 1, reviews: 3 });
	});

	it('rejects when a count cannot be fetched', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(fetchWorkspaceContents(ctx.session.study, 7)).rejects.toBeTruthy();
	});
});
