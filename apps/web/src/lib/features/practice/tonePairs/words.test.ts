import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/api/entryBases', () => ({ loadEntryBases: vi.fn() }));

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { loadEntryBases } from '$lib/api/entryBases';
import type { EntryBase, Scheme } from '$lib/api/types';
import type { DrillAnswer } from '$lib/studycore/drills';
import type { StudyCard } from '$lib/studycore/types';
import { testContext } from '$lib/testing/context';
import {
	MAX_DECK_WORDS,
	PAIR_WORDS,
	addWords,
	deckEntryIds,
	levelWords,
	loadPairItems,
	pairItems,
	wordScheme,
	type PairWords
} from './words';

const base = (id: number, written: string, pinyin: string | string[]): EntryBase => ({
	id,
	language: 'zh',
	kind: 'word',
	written,
	readings: (Array.isArray(pinyin) ? pinyin : [pinyin]).map((value, ord) => ({ type: 'pinyin', value, plain: '', ord })),
	attrs: {},
	radicalId: null
});

const scheme = (id: number, packId: string, unit = 'word', language = 'zh'): Scheme => ({
	id,
	name: packId,
	unit,
	language,
	packId,
	levels: [
		{ id: id * 10 + 2, ord: 2, name: 'Level 2' },
		{ id: id * 10 + 1, ord: 1, name: 'Level 1' }
	]
});

const card = (entryId: number, createdAt: string, written?: string): StudyCard => ({
	id: `c${entryId}-${createdAt}`,
	kind: 'vocab',
	entryId,
	written,
	deckIds: [],
	createdAt
});

const answer = (item: string, drill = 'tone-pairs'): DrillAnswer => ({ id: item, workspaceId: 1, ts: '', at: 0, drill, item, mode: 'mark', grade: 3 });

afterEach(() => vi.resetAllMocks());

describe('addWords', () => {
	it('sorts words into their pairs, in order, each entry once, leaving out words without a pair', () => {
		const words = addWords(new Map(), [base(1, '你好', 'nǐ hǎo'), base(2, '东西', ['dōng xī', 'dōng xi']), base(3, '很好', 'hěn hǎo'), base(1, '你好', 'nǐ hǎo'), base(4, '好', 'hǎo')], true);
		expect([...words.keys()]).toEqual(['3-3']);
		expect(words.get('3-3')!.map((w) => [w.entryId, w.written, w.fromDeck])).toEqual([
			[1, '你好', true],
			[3, '很好', true]
		]);
	});

	it('keeps PAIR_WORDS level words and MAX_DECK_WORDS deck words a pair', () => {
		const many = Array.from({ length: 60 }, (_, i) => base(100 + i, '你好', 'nǐ hǎo'));
		expect(addWords(new Map(), many, false).get('3-3')).toHaveLength(PAIR_WORDS);
		expect(addWords(new Map(), many, true).get('3-3')).toHaveLength(MAX_DECK_WORDS);
	});
});

describe('wordScheme', () => {
	it('prefers hsk-words, then an hsk- pack, then any word list of the language', () => {
		const list = [scheme(1, 'mine'), scheme(2, 'hsk-old'), scheme(3, 'hsk-words'), scheme(4, 'hsk-chars', 'character')];
		expect(wordScheme(list, 'zh')?.id).toBe(3);
		expect(wordScheme(list.filter((s) => s.id !== 3), 'zh')?.id).toBe(2);
		expect(wordScheme([scheme(1, 'mine'), scheme(4, 'hsk-chars', 'character')], 'zh')?.id).toBe(1);
		expect(wordScheme([scheme(4, 'hsk-chars', 'character')], 'zh')).toBeNull();
		expect(wordScheme(list, 'zh-Hant')).toBeNull();
	});
});

describe('deckEntryIds', () => {
	it('lists the entries in card order, once, skipping snapshots that are not two characters', () => {
		const cards = [card(3, '2026-11-03', '很好'), card(1, '2026-11-01', '你好'), card(1, '2026-11-04', '你好'), card(2, '2026-11-02', '好'), card(4, '2026-11-05')];
		expect(deckEntryIds(cards)).toEqual([1, 3, 4]);
	});
});

describe('pairItems', () => {
	it('gives the pairs with words in grid order, deck words first, and the word after the answers so far', () => {
		const deck: PairWords = addWords(new Map(), [base(1, '你好', 'nǐ hǎo')], true);
		const level: PairWords = addWords(new Map(), [base(1, '你好', 'nǐ hǎo'), base(3, '很好', 'hěn hǎo'), base(5, '学习', 'xué xí')], false);
		const items = pairItems(deck, level, [answer('3-3'), answer('3-3'), answer('3-3'), answer('3-3', 'other')]);
		expect(items.map((i) => i.key)).toEqual(['2-2', '3-3']);
		expect(items[1].data!.words.map((w) => [w.entryId, w.fromDeck])).toEqual([
			[1, true],
			[3, false]
		]);
		// Three answers of 3-3, two words: the second word.
		expect(items[1].data!.next).toBe(1);
		expect(items[0].data!.next).toBe(0);
	});
});

describe('levelWords', () => {
	it('reads the lowest levels until every pair is full or the levels end, once a session', async () => {
		const ctx = testContext();
		vi.mocked(getSchemes).mockResolvedValue([scheme(3, 'hsk-words')]);
		vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) => (level === 'Level 1' ? [base(1, '你好', 'nǐ hǎo')] : [base(5, '学习', 'xué xí')]));
		const words = await levelWords(ctx.session, 'zh');
		expect(vi.mocked(getSchemeEntries).mock.calls).toEqual([
			[3, 'Level 1'],
			[3, 'Level 2']
		]);
		expect([...words.keys()].sort()).toEqual(['2-2', '3-3']);
		await levelWords(ctx.session, 'zh');
		expect(getSchemes).toHaveBeenCalledTimes(1);
	});

	it('forgets a failure, so the next load asks again', async () => {
		const ctx = testContext();
		vi.mocked(getSchemes).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
		await expect(levelWords(ctx.session, 'zh')).rejects.toThrow('offline');
		expect((await levelWords(ctx.session, 'zh')).size).toBe(0);
	});
});

describe('loadPairItems', () => {
	it("puts the workspace's deck words before the level words, and keeps the deck words when the level list fails", async () => {
		const ctx = testContext();
		vi.mocked(loadEntryBases).mockResolvedValue(new Map([[1, base(1, '你好', 'nǐ hǎo')]]));
		vi.mocked(getSchemes).mockRejectedValue(new Error('offline'));
		const items = await loadPairItems(ctx.session, 'zh', [card(1, '2026-11-01', '你好')], []);
		expect(items.map((i) => [i.key, i.data!.words.map((w) => w.written)])).toEqual([['3-3', ['你好']]]);
		expect(vi.mocked(loadEntryBases).mock.calls[0][1]).toEqual([1]);
	});
});
