import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { workspaces } from '../workspaces';
import type { Deck, StudyCard } from './types';
import {
	GENERAL_DECK_ID,
	addCard,
	cardsInDecks,
	createDeck,
	deleteDeck,
	loadStudyData,
	renameDeck
} from './store';

const PLUGIN_ID = 'qinqin-flashcards';
const WORKSPACE_ID = 7;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

interface PluginDataRow {
	pluginId: string;
	key: string;
	userId: number;
	workspaceId: number | null;
	data: unknown;
	version: number;
	updatedAt: string;
	deletedAt: string | null;
}

function pluginRow(
	key: string,
	data: unknown,
	overrides: Partial<PluginDataRow> = {}
): PluginDataRow {
	return {
		pluginId: PLUGIN_ID,
		key,
		userId: 1,
		workspaceId: WORKSPACE_ID,
		data,
		version: 1,
		updatedAt: '2026-01-01T00:00:00Z',
		deletedAt: null,
		...overrides
	};
}

function deck(id: string, name: string, createdAt = '2026-01-01T00:00:00Z'): Deck {
	return { id, name, createdAt };
}

function card(
	id: string,
	entryId: number,
	deckIds: string[],
	createdAt = '2026-01-02T00:00:00Z'
): StudyCard {
	return { id, kind: 'vocab', entryId, deckIds, createdAt };
}

function selectWorkspace(id: number | null): void {
	workspaces.set({
		list: [],
		current:
			id === null
				? null
				: { id, language: 'zh', settings: {}, updatedAt: '2026-01-01T00:00:00Z' }
	});
}

function calls(): Array<[string, RequestInit | undefined]> {
	return vi.mocked(fetch).mock.calls as Array<[string, RequestInit | undefined]>;
}

function putBodies(): Array<{ url: string; body: unknown }> {
	return calls()
		.filter(([, init]) => init?.method === 'PUT')
		.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init?.body)) }));
}

describe('study store', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		selectWorkspace(WORKSPACE_ID);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	describe('loadStudyData', () => {
		it('parses only active flashcard rows of the current workspace', async () => {
			const general = deck('general', 'General');
			const custom = deck('deck-1', 'HSK 2');
			const word = card('card-1', 42, ['general']);
			const sentenceCard = {
				...card('card-2', 43, ['general', 'deck-1']),
				sentenceId: 9
			};
			vi.mocked(fetch).mockResolvedValue(
				jsonResponse({
					pluginData: [
						pluginRow('deck:general', general),
						pluginRow('deck:deck-1', custom),
						pluginRow('card:card-1', word),
						pluginRow('card:card-2', sentenceCard),
						// Another plugin's data is not study data.
						pluginRow('deck:other-plugin', deck('other-plugin', 'Other'), {
							pluginId: 'qinqin-heatmap'
						}),
						// Another workspace's data never leaks in.
						pluginRow('deck:other-workspace', deck('other-workspace', 'Elsewhere'), {
							workspaceId: 8
						}),
						// User-global (workspace-less) rows are not study data.
						pluginRow('deck:global', deck('global', 'Global'), { workspaceId: null }),
						// Tombstones are deleted rows.
						pluginRow('deck:gone', deck('gone', 'Gone'), {
							deletedAt: '2026-01-03T00:00:00Z'
						}),
						// Keys the study layer does not own are ignored.
						pluginRow('settings:study', { newLimit: 20 }),
						// A malformed payload is skipped rather than crashing.
						pluginRow('deck:broken', { name: 'No id' })
					]
				})
			);

			const data = await loadStudyData();

			expect(data.decks).toEqual([general, custom]);
			expect(data.cards).toEqual([word, sentenceCard]);
			expect(calls().map(([url]) => String(url))).toEqual([
				'/api/sync/pull?cursor=1970-01-01T00:00:00Z'
			]);
		});

		it('returns empty arrays when the pull has no plugin data', async () => {
			vi.mocked(fetch).mockResolvedValue(jsonResponse({ cursor: '2026-01-01T00:00:00Z' }));

			await expect(loadStudyData()).resolves.toEqual({ decks: [], cards: [] });
		});

		it('returns empty arrays when matching rows only hold other keys', async () => {
			vi.mocked(fetch).mockResolvedValue(
				jsonResponse({ pluginData: [pluginRow('settings:study', { newLimit: 20 })] })
			);

			await expect(loadStudyData()).resolves.toEqual({ decks: [], cards: [] });
		});

		it('fails when no workspace is selected', async () => {
			selectWorkspace(null);

			await expect(loadStudyData()).rejects.toThrow(/workspace/i);
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe('createDeck', () => {
		it('writes a ULID-keyed deck scoped to the current workspace', async () => {
			vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));

			const created = await createDeck('  HSK 3  ');

			expect(created.id).toMatch(ULID);
			expect(created.name).toBe('  HSK 3  ');
			expect(created.createdAt).toEqual(expect.any(String));
			expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
			const [call] = calls();
			expect(String(call[0])).toBe(
				`/api/plugins/${PLUGIN_ID}/data/deck:${created.id}?workspace=${WORKSPACE_ID}`
			);
			expect(call[1]?.method).toBe('PUT');
			expect(JSON.parse(String(call[1]?.body))).toEqual(created);
		});

		it('fails without writing when no workspace is selected', async () => {
			selectWorkspace(null);

			await expect(createDeck('HSK 3')).rejects.toThrow(/workspace/i);
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe('renameDeck', () => {
		it('rewrites the deck under the same id and creation time', async () => {
			const existing = deck('deck-1', 'Old name', '2026-01-01T00:00:00Z');
			vi.mocked(fetch).mockImplementation(async (_input, init) => {
				if (init?.method === 'PUT') return jsonResponse({ version: 2 });
				return jsonResponse({ pluginData: [pluginRow('deck:deck-1', existing)] });
			});

			const renamed = await renameDeck('deck-1', 'New name');

			expect(renamed).toEqual(deck('deck-1', 'New name', '2026-01-01T00:00:00Z'));
			expect(putBodies()).toEqual([
				{
					url: `/api/plugins/${PLUGIN_ID}/data/deck:deck-1?workspace=${WORKSPACE_ID}`,
					body: renamed
				}
			]);
		});

		it('refuses to rename a deck that does not exist', async () => {
			vi.mocked(fetch).mockResolvedValue(jsonResponse({ pluginData: [] }));

			await expect(renameDeck('missing', 'New name')).rejects.toThrow(/deck/i);
			expect(putBodies()).toEqual([]);
		});
	});

	describe('deleteDeck', () => {
		it('deletes the deck and moves cards that only lived there to general', async () => {
			const orphan = card('card-orphan', 42, ['deck-1'], '2026-01-02T00:00:00Z');
			const shared = card('card-shared', 43, ['deck-1', 'deck-2']);
			const elsewhere = card('card-elsewhere', 44, ['deck-2']);
			vi.mocked(fetch).mockImplementation(async (_input, init) => {
				if (init?.method === 'DELETE') return new Response(null, { status: 204 });
				if (init?.method === 'PUT') return jsonResponse({ version: 2 });
				return jsonResponse({
					pluginData: [
						pluginRow('deck:deck-1', deck('deck-1', 'Doomed')),
						pluginRow('deck:deck-2', deck('deck-2', 'Kept')),
						pluginRow('card:card-orphan', orphan),
						pluginRow('card:card-shared', shared),
						pluginRow('card:card-elsewhere', elsewhere)
					]
				});
			});

			await deleteDeck('deck-1');

			expect(calls().filter(([, init]) => init?.method === 'DELETE')).toEqual([
				[
					`/api/plugins/${PLUGIN_ID}/data/deck:deck-1?workspace=${WORKSPACE_ID}`,
					expect.objectContaining({ method: 'DELETE' })
				]
			]);
			expect(putBodies()).toEqual([
				{
					url: `/api/plugins/${PLUGIN_ID}/data/card:card-orphan?workspace=${WORKSPACE_ID}`,
					body: { ...orphan, deckIds: [GENERAL_DECK_ID] }
				},
				{
					url: `/api/plugins/${PLUGIN_ID}/data/card:card-shared?workspace=${WORKSPACE_ID}`,
					body: { ...shared, deckIds: ['deck-2'] }
				}
			]);
		});

		it('refuses to delete the implicit general deck without touching the server', async () => {
			await expect(deleteDeck(GENERAL_DECK_ID)).rejects.toThrow(/general/i);
			expect(fetch).not.toHaveBeenCalled();
		});

		it('keeps a card in its other decks when one deck is deleted', async () => {
			const shared = card('card-shared', 43, ['deck-1', 'deck-2']);
			vi.mocked(fetch).mockImplementation(async (_input, init) => {
				if (init?.method === 'DELETE') return new Response(null, { status: 204 });
				if (init?.method === 'PUT') return jsonResponse({ version: 2 });
				return jsonResponse({
					pluginData: [
						pluginRow('deck:deck-1', deck('deck-1', 'Doomed')),
						pluginRow('deck:deck-2', deck('deck-2', 'Kept')),
						pluginRow('card:card-shared', shared)
					]
				});
			});

			await deleteDeck('deck-1');

			expect(putBodies()).toEqual([
				{
					url: `/api/plugins/${PLUGIN_ID}/data/card:card-shared?workspace=${WORKSPACE_ID}`,
					body: { ...shared, deckIds: ['deck-2'] }
				}
			]);
			expect(calls().some(([, init]) => init?.method === 'DELETE')).toBe(true);
		});

		it('lands a multi-deck card in general after sequential deck deletions', async () => {
			const decks = new Map<string, Deck>([
				['deck:deck-1', deck('deck-1', 'One')],
				['deck:deck-2', deck('deck-2', 'Two')]
			]);
			const cards = new Map<string, StudyCard>([
				['card:card-1', card('card-1', 42, ['deck-1', 'deck-2'])]
			]);
			const keyOf = (input: unknown): string => {
				const path = String(input).split('/data/')[1] ?? '';
				return path.split('?')[0];
			};
			vi.mocked(fetch).mockImplementation(async (input, init) => {
				if (init?.method === 'PUT') {
					const key = keyOf(input);
					const body = JSON.parse(String(init.body)) as StudyCard;
					cards.set(key, body);
					return jsonResponse({ version: 2 });
				}
				if (init?.method === 'DELETE') {
					decks.delete(keyOf(input));
					return new Response(null, { status: 204 });
				}
				return jsonResponse({
					pluginData: [
						...[...decks].map(([key, data]) => pluginRow(key, data)),
						...[...cards].map(([key, data]) => pluginRow(key, data))
					]
				});
			});

			await deleteDeck('deck-1');
			await deleteDeck('deck-2');

			expect(cards.get('card:card-1')?.deckIds).toEqual([GENERAL_DECK_ID]);
			expect(putBodies().map((entry) => (entry.body as StudyCard).deckIds)).toEqual([
				['deck-2'],
				[GENERAL_DECK_ID]
			]);
		});
	});

	describe('addCard', () => {
		it('writes a vocab card in the general deck', async () => {
			vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));

			const added = await addCard(42);

			expect(added.id).toMatch(ULID);
			expect(added.kind).toBe('vocab');
			expect(added.entryId).toBe(42);
			expect(added.deckIds).toEqual([GENERAL_DECK_ID]);
			expect(added.createdAt).toEqual(expect.any(String));
			expect('sentenceId' in added).toBe(false);
			const [call] = calls();
			expect(String(call[0])).toBe(
				`/api/plugins/${PLUGIN_ID}/data/card:${added.id}?workspace=${WORKSPACE_ID}`
			);
			expect(call[1]?.method).toBe('PUT');
			expect(JSON.parse(String(call[1]?.body))).toEqual(added);
		});

		it('records the sentence id when one is given', async () => {
			vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 1 }));

			const added = await addCard(42, 9);

			expect(added.sentenceId).toBe(9);
			expect(JSON.parse(String(calls()[0][1]?.body))).toEqual(added);
		});
	});

	describe('cardsInDecks', () => {
		it('keeps cards in any of the requested decks', () => {
			const general = card('card-1', 1, ['general']);
			const custom = card('card-2', 2, ['deck-1']);
			const both = card('card-3', 3, ['deck-1', 'deck-2']);

			expect(cardsInDecks([general, custom, both], ['general'])).toEqual([general]);
			expect(cardsInDecks([general, custom, both], ['deck-1'])).toEqual([custom, both]);
			expect(cardsInDecks([general, custom, both], ['deck-1', 'deck-2'])).toEqual([
				custom,
				both
			]);
			expect(cardsInDecks([general, custom, both], [])).toEqual([]);
		});
	});
});
