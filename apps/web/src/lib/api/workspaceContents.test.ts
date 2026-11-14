import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { fetchWorkspaceContents } from './workspaceContents';

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

	it('counts the books, live cards and reviews of one workspace', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url === '/api/library/books?workspace=7') return jsonResponse([{ id: 1 }, { id: 2 }]);
			if (url.startsWith('/api/sync/pull')) {
				return jsonResponse({
					pluginData: [
						{ pluginId: 'qinqin-flashcards', key: 'card:a', workspaceId: 7, deletedAt: null },
						{ pluginId: 'qinqin-flashcards', key: 'card:b', workspaceId: 7, deletedAt: null },
						{ pluginId: 'qinqin-flashcards', key: 'card:c', workspaceId: 7, deletedAt: '2026-01-01T00:00:00Z' },
						{ pluginId: 'qinqin-flashcards', key: 'deck:d', workspaceId: 7, deletedAt: null },
						{ pluginId: 'qinqin-flashcards', key: 'card:e', workspaceId: 3, deletedAt: null },
						{ pluginId: 'other', key: 'card:f', workspaceId: 7, deletedAt: null }
					]
				});
			}
			if (url === '/api/events?workspace=7') {
				return jsonResponse([{ type: 'review' }, { type: 'review' }, { type: 'review' }, { type: 'session' }]);
			}
			return new Response('unexpected', { status: 500 });
		});

		await expect(fetchWorkspaceContents(7)).resolves.toEqual({ books: 2, cards: 2, decks: 1, reviews: 3 });
	});

	it('rejects when a count cannot be fetched', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(fetchWorkspaceContents(7)).rejects.toBeTruthy();
	});
});
