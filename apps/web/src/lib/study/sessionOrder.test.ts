import { describe, expect, it, vi } from 'vitest';
import type { FrequencyPack, Scheme } from '$lib/api/types';
import { MIXED_NOTE, OFFLINE_NOTE } from './newOrderView';
import { candidateNewEntries, deckOrdersOf, sessionNewKey, type SessionKeyDeps } from './sessionOrder';
import type { ReviewEvent, StudyCard } from './types';

const jiten = {
	id: 3,
	packId: 'jiten-frequency',
	name: 'Jiten',
	version: '1',
	language: 'ja',
	license: 'x',
	attribution: 'y'
} as FrequencyPack;
const jlptWords = {
	id: 5,
	name: 'JLPT words',
	unit: 'word',
	language: 'ja',
	packId: 'jlpt-words',
	levels: []
} as Scheme;

function deps(over: Partial<SessionKeyDeps> = {}): SessionKeyDeps {
	return {
		packs: vi.fn(async () => [jiten]),
		schemes: vi.fn(async () => [jlptWords]),
		ranks: vi.fn(async (_language: string, ids: readonly number[]) => ({
			pack: { id: 3, packId: 'jiten-frequency', name: 'Jiten' },
			rankOf: (id: number) => (ids.includes(id) ? id * 10 : null)
		})),
		levelKeys: vi.fn(async () => (id: number) => (id === 1 ? 1 : null)),
		...over
	};
}

const base = { language: 'ja', newEntryIds: [1, 2], online: true };

describe('sessionNewKey', () => {
	it('decks: the decks’ common frequency order loads ranks for the new entries only', async () => {
		const d = deps();
		const r = await sessionNewKey(
			{ ...base, mode: 'decks', order: 'deck', deckOrders: [{ by: 'frequency' }] },
			d
		);
		expect(r.note).toBeNull();
		expect(r.key?.(2)).toBe(20);
		expect(d.ranks).toHaveBeenCalledWith('ja', [1, 2]);
	});

	it('decks: added asks nothing', async () => {
		const d = deps();
		const r = await sessionNewKey({ ...base, mode: 'decks', order: 'deck', deckOrders: [null] }, d);
		expect(r).toEqual({ key: null, note: null });
		expect(d.packs).not.toHaveBeenCalled();
	});

	it('decks: different orders → added with the mixed note', async () => {
		const r = await sessionNewKey(
			{ ...base, mode: 'decks', order: 'deck', deckOrders: [{ by: 'frequency' }, null] },
			deps()
		);
		expect(r).toEqual({ key: null, note: MIXED_NOTE });
	});

	it('decks: by level uses the scheme with that pack id', async () => {
		const d = deps();
		const r = await sessionNewKey(
			{ ...base, mode: 'decks', order: { by: 'level', packId: 'jlpt-words' }, deckOrders: [] },
			d
		);
		expect(r.key?.(1)).toBe(1);
		expect(d.levelKeys).toHaveBeenCalledWith(jlptWords);
	});

	it('a frequency order without a pack behaves as added and says so', async () => {
		const r = await sessionNewKey(
			{ ...base, mode: 'decks', order: { by: 'frequency' }, deckOrders: [] },
			deps({ packs: vi.fn(async () => []) })
		);
		expect(r.key).toBeNull();
		expect(r.note).toBe('No frequency list is installed for Japanese; using the order added.');
	});

	it('offline or a failed request: added with the connection note', async () => {
		const offline = await sessionNewKey(
			{ ...base, online: false, mode: 'decks', order: { by: 'frequency' }, deckOrders: [] },
			deps()
		);
		expect(offline).toEqual({ key: null, note: OFFLINE_NOTE });
		const failed = await sessionNewKey(
			{ ...base, mode: 'decks', order: { by: 'frequency' }, deckOrders: [] },
			deps({ ranks: vi.fn(async () => Promise.reject(new TypeError('fetch'))) })
		);
		expect(failed).toEqual({ key: null, note: OFFLINE_NOTE });
	});

	it('levels: level order unless frequency on a word scheme', async () => {
		const d = deps();
		expect(
			await sessionNewKey({ ...base, mode: 'levels', order: 'deck', levelUnit: 'word' }, d)
		).toEqual({
			key: null,
			note: null
		});
		expect(
			await sessionNewKey(
				{ ...base, mode: 'levels', order: { by: 'frequency' }, levelUnit: 'character' },
				d
			)
		).toEqual({ key: null, note: null });
		const words = await sessionNewKey(
			{ ...base, mode: 'levels', order: { by: 'frequency' }, levelUnit: 'word' },
			d
		);
		expect(words.key?.(1)).toBe(10);
	});
});

describe('candidateNewEntries', () => {
	const card = (
		id: string,
		entryId: number,
		deckIds = ['general'],
		kind: StudyCard['kind'] = 'vocab'
	): StudyCard => ({
		id,
		kind,
		entryId,
		deckIds,
		createdAt: '2026-01-01T00:00:00.000Z'
	});
	const reviewed = (cardId: string): ReviewEvent => ({
		id: `e-${cardId}`,
		workspaceId: 1,
		device: 'web',
		ts: '2026-01-02T00:00:00.000Z',
		type: 'review',
		payload: { cardId, mode: 'vocab', grade: 3 }
	});

	it('decks: the entries of never-reviewed cards in the selected decks', () => {
		const cards = [card('a', 1), card('b', 2), card('c', 3, ['other']), card('d', 4)];
		expect(candidateNewEntries({ cards, reviews: [reviewed('b')], deckIds: ['general'] })).toEqual([
			1, 4
		]);
	});

	it('levels: level entries without a reviewed card of every selected kind', () => {
		const cards = [card('a', 1), card('b', 2), card('w2', 2, ['general'], 'writing')];
		const entries = [1, 2, 3];
		expect(
			candidateNewEntries({
				cards,
				reviews: [reviewed('a'), reviewed('b')],
				entries,
				kinds: ['vocab']
			})
		).toEqual([3]);
		expect(
			candidateNewEntries({
				cards,
				reviews: [reviewed('a'), reviewed('b')],
				entries,
				kinds: ['vocab', 'writing']
			})
		).toEqual([1, 2, 3]);
	});
});

describe('deckOrdersOf', () => {
	it('takes the orders of the selected decks that still exist', () => {
		const settings = { general: { deckId: 'general', cardTypes: [], newOrder: { by: 'frequency' as const }, extra: {} } };
		expect(deckOrdersOf(['general', 'gone'], [{ id: 'd1' }], settings)).toEqual([{ by: 'frequency' }]);
		expect(deckOrdersOf(['general', 'd1'], [{ id: 'd1' }], settings)).toEqual([{ by: 'frequency' }, null]);
		expect(deckOrdersOf(['gone'], [], undefined)).toEqual([]);
	});
});
