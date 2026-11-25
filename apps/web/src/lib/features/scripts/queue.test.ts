import { describe, expect, it } from 'vitest';
import { systemById } from './packs';
import { DAY, MINUTE, type ItemState } from './progress';
import { buildRound, distractors, itemQuestion, pickIds, seeded, shows, shuffle, syllableQuestion, wordQuestion } from './queue';

const T0 = Date.parse('2026-11-26T10:00:00Z');
const hira = systemById('hiragana')!;
const hangul = systemById('hangul')!;
const cyr = systemById('cyrillic')!;
const st = (box: number, dueAt: number, lastAt = T0): ItemState => ({ box, correct: box, wrong: 0, lastAt, dueAt });

describe('shuffle and seeded', () => {
	it('is deterministic for a seed and keeps every element', () => {
		const a = shuffle([1, 2, 3, 4, 5, 6], seeded(7));
		expect(a).toEqual(shuffle([1, 2, 3, 4, 5, 6], seeded(7)));
		expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
	});
});

describe('pickIds', () => {
	const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
	it('takes the due ones first, then new ones up to the limit', () => {
		const map = new Map([
			['a', st(2, T0 - DAY)],
			['b', st(2, T0 - 2 * DAY)],
			['c', st(2, T0 + DAY)]
		]);
		const got = pickIds(ids, map, T0, 4, 2, seeded(1));
		expect(new Set(got)).toEqual(new Set(['a', 'b', 'd', 'e']));
	});

	it('keeps room for new items when many are due', () => {
		const map = new Map(ids.slice(0, 6).map((id, n) => [id, st(1, T0 - (n + 1) * MINUTE)] as const));
		const got = pickIds(ids, map, T0, 4, 2, seeded(1));
		expect(got).toHaveLength(4);
		expect(got.filter((id) => !map.has(id))).toHaveLength(2);
	});

	it('fills with the weakest seen items, then with more new ones', () => {
		const map = new Map([
			['a', st(4, T0 + DAY, T0)],
			['b', st(1, T0 + DAY, T0)]
		]);
		expect(new Set(pickIds(['a', 'b'], map, T0, 2, 5, seeded(1)))).toEqual(new Set(['a', 'b']));
		expect(pickIds(['a', 'b', 'c', 'd'], map, T0, 3, 0, seeded(1)).filter((x) => x === 'a' || x === 'b' || x === 'c' || x === 'd')).toHaveLength(3);
		const weakFirst = pickIds(['a', 'b'], map, T0, 1, 0, seeded(1));
		expect(weakFirst).toEqual(['b']);
	});

	it('never repeats and never exceeds the count', () => {
		const got = pickIds(ids, new Map(), T0, 20, 3, seeded(2));
		expect(new Set(got).size).toBe(got.length);
		expect(got.length).toBe(ids.length);
	});
});

describe('distractors', () => {
	it('never share a sound with the answer or with each other, whatever the seed', () => {
		const ji = hira.items.find((i) => i.glyph === 'じ')!;
		for (let seed = 1; seed < 40; seed++) {
			const d = distractors(ji, hira.items, 3, seeded(seed));
			expect(d).toHaveLength(3);
			const sounds = d.flatMap((i) => i.sounds);
			expect(new Set(sounds).size).toBe(sounds.length);
			for (const i of d) expect(i.sounds.some((s) => ji.sounds.includes(s))).toBe(false);
		}
	});

	it('prefer the same chart group', () => {
		const ka = hira.items.find((i) => i.glyph === 'か')!;
		const d = distractors(ka, hira.items, 3, seeded(3));
		expect(d.every((i) => i.group === 'basic')).toBe(true);
	});
});

describe('itemQuestion', () => {
	const a = hira.items.find((i) => i.glyph === 'あ')!;

	it('recognise: the glyph, four sounds, one right', () => {
		const q = itemQuestion(hira, 'recognise', a, seeded(1));
		expect(q).toMatchObject({ mode: 'recognise', prompt: 'あ', answer: 'a', itemId: 'hiragana:あ', speak: 'あ' });
		expect(q.options).toHaveLength(4);
		expect(q.options.filter((o) => o === 'a')).toHaveLength(1);
		expect(new Set(q.options).size).toBe(4);
	});

	it('recall: the sound, four glyphs', () => {
		const q = itemQuestion(hira, 'recall', a, seeded(1));
		expect(q).toMatchObject({ prompt: 'a', answer: 'あ' });
		expect(q.options).toContain('あ');
		expect(new Set(q.options).size).toBe(4);
	});

	it('type: no options, the glyph is accepted; a cased letter in both cases', () => {
		const q = itemQuestion(hira, 'type', a, seeded(1));
		expect(q).toMatchObject({ prompt: 'a', options: [], accepts: ['あ'] });
		const d = cyr.items.find((i) => i.glyph === 'Д')!;
		const qd = itemQuestion(cyr, 'type', d, seeded(1));
		expect(qd.accepts).toEqual(['Д', 'д']);
		expect(qd.key).toBe('L');
		expect(shows(d)).toBe('Д д');
	});

	it('a Hangul jamo is spoken as a syllable', () => {
		const g = hangul.items.find((i) => i.glyph === 'ㄱ')!;
		expect(itemQuestion(hangul, 'recognise', g, seeded(1)).speak).toBe('가');
	});
});

describe('read questions', () => {
	it('a word question has its own romanisation among four, once', () => {
		const w = hira.words[0];
		const q = wordQuestion(hira, w, seeded(4));
		expect(q.options).toHaveLength(4);
		expect(q.options.filter((o) => o === w.roman)).toHaveLength(1);
		expect(q).toMatchObject({ mode: 'read', itemId: `hiragana:word:${w.text}`, gloss: w.gloss });
	});

	it('a syllable question builds a block from the jamo the learner has seen', () => {
		const seen = new Set(['ㄱ', 'ㄴ', 'ㅁ', 'ㅏ', 'ㅣ', 'ㅗ'].map((j) => `hangul:${j}`));
		for (let seed = 1; seed < 30; seed++) {
			const q = syllableQuestion(hangul, seen, seeded(seed));
			expect(q.options).toContain(q.answer);
			expect(new Set(q.options).size).toBe(q.options.length);
			expect([...q.prompt]).toHaveLength(1);
		}
	});
});

describe('buildRound', () => {
	it('a first round of kana recognise has ten new, distinct questions', () => {
		const round = buildRound(hira, 'recognise', new Map(), T0, seeded(5));
		expect(round).toHaveLength(10);
		expect(new Set(round.map((q) => q.itemId)).size).toBe(10);
		// new items are asked in chart order: the first five of the chart are in the round
		const first5 = hira.items.slice(0, 5).map((i) => i.id);
		expect(first5.every((id) => round.some((q) => q.itemId === id))).toBe(true);
	});

	it('a Hangul read round mixes words and blocks', () => {
		const round = buildRound(hangul, 'read', new Map(), T0, seeded(5));
		expect(round).toHaveLength(10);
		expect(round.filter((q) => q.itemId.includes(':syllable:'))).toHaveLength(5);
		expect(round.filter((q) => q.itemId.includes(':word:'))).toHaveLength(5);
	});

	it('a kana read round asks words only', () => {
		const round = buildRound(hira, 'read', new Map(), T0, seeded(5));
		expect(round.every((q) => q.itemId.includes(':word:'))).toBe(true);
	});

	it('is the same for the same seed', () => {
		expect(buildRound(cyr, 'recall', new Map(), T0, seeded(9))).toEqual(buildRound(cyr, 'recall', new Map(), T0, seeded(9)));
	});
});
