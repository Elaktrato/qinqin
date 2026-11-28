import { describe, expect, it } from 'vitest';
import checks from '../../../../../../../docs/contracts/counters/check.json';
import words from '../../../../../../../docs/contracts/counters/words.json';
import readings from '../../../../../../../docs/contracts/counters/readings.json';
import measures from '../../../../../../../docs/contracts/counters/measures.json';
import { CONTAINERS, CONTAINER_AVOID, checkMeasure, checkReading, nounChoices, readingChoices } from './check';
import { parseCounters, parseWords, type CounterNoun } from './words';

const parsed = parseWords(words);
const nounOf = new Map<string, CounterNoun>(words.words.map((w, i) => [w.key, parsed.words[i]]));
const counters = parseCounters(readings);
const numberOf = (item: string) => {
	const [id, n] = item.split(':');
	return counters.find((c) => c.id === id)?.numbers.find((x) => x.number === n);
};

describe('checking a typed noun answer (docs/contracts/counters/check.json)', () => {
	for (const c of checks.nouns) {
		for (const input of c.inputs) {
			it(`${c.key}: ${JSON.stringify(input.typed)} is ${input.verdict}`, () => {
				const noun = nounOf.get(c.key);
				expect(noun).toBeDefined();
				expect(checkMeasure(input.typed, noun!)).toBe(input.verdict);
			});
		}
	}
});

describe('checking a typed reading (docs/contracts/counters/check.json)', () => {
	for (const c of checks.readings) {
		for (const input of c.inputs) {
			it(`${c.item}: ${JSON.stringify(input.typed)} is ${input.verdict}`, () => {
				const n = numberOf(c.item);
				expect(n).toBeDefined();
				expect(checkReading(input.typed, n!)).toBe(input.verdict);
			});
		}
	}
});

describe('the readings matrix (readings.json)', () => {
	it('accepts every answer in kana and romaji and refuses every mistake', () => {
		for (const c of counters) {
			for (const n of c.numbers) {
				n.answers.forEach((a, i) => {
					const want = i === 0 ? 'canonical' : 'accepted';
					expect(checkReading(a.reading, n), `${c.id}:${n.number} ${a.reading}`).toBe(want);
					if (i === 0) expect(checkReading(a.romaji, n), `${c.id}:${n.number} ${a.romaji}`).toBe('canonical');
					else expect(checkReading(a.romaji, n), `${c.id}:${n.number} ${a.romaji}`).not.toBe('wrong');
				});
				for (const m of n.mistakes) expect(checkReading(m.reading, n), `${c.id}:${n.number} ${m.reading}`).toBe('wrong');
			}
		}
	});
});

const seq = () => {
	let i = 0;
	return () => ((i++ * 0.37) % 1);
};

describe('choices', () => {
	it('a noun: the canonical answer and three wrong ones, never another right one nor the 个 fallback', () => {
		const cat = nounOf.get('zh:猫')!;
		for (let k = 0; k < 20; k++) {
			const options = nounChoices(cat, parsed.pools.zh ?? [], seq());
			expect(options).toHaveLength(4);
			expect(options.filter((o) => checkMeasure(o, cat) === 'canonical')).toHaveLength(1);
			expect(options.some((o) => checkMeasure(o, cat) === 'fallback' || checkMeasure(o, cat) === 'accepted')).toBe(false);
		}
		const book = nounOf.get('zh:书')!;
		const options = nounChoices(book, parsed.pools.zh ?? [], seq());
		expect(options.filter((o) => checkMeasure(o, book) !== 'wrong')).toEqual(['本']);
	});

	it('a traditional noun shows the traditional choices', () => {
		const cat = { ...nounOf.get('zh:猫')!, traditional: true, measures: [{ written: '隻', variants: ['只'], readings: [] }] };
		const options = nounChoices(cat, parsed.pools.zh ?? [], seq());
		expect(options).toContain('隻');
		expect(options.some((o) => ['个', '张', '条', '辆'].includes(o))).toBe(false);
	});

	it('a reading: the canonical one, the mistakes first, never an accepted one', () => {
		const n = numberOf('hon:3')!;
		const options = readingChoices(n, counters.find((c) => c.id === 'hon')!, seq());
		expect(options).toHaveLength(4);
		expect(options).toContain('さんぼん');
		expect(options).toContain('さんほん');
		expect(options).toContain('さんぽん');
		const kai = numberOf('kai-floor:3')!;
		const kaiOptions = readingChoices(kai, counters.find((c) => c.id === 'kai-floor')!, seq());
		expect(kaiOptions.filter((o) => checkReading(o, kai) !== 'wrong')).toEqual([kai.answers[0].reading]);
		expect(new Set(kaiOptions).size).toBe(kaiOptions.length);
	});

	it('a container noun never gets another container as a wrong choice; a noun never its own character', () => {
		const tea: CounterNoun = { id: 1, language: 'zh', written: '茶', readings: [], gloss: 'tea', measures: [{ written: '杯', variants: [], readings: [] }], fallback: null, traditional: false };
		for (let k = 0; k < 30; k++) {
			const options = nounChoices(tea, parsed.pools.zh ?? [], () => Math.random());
			expect(options.filter((o) => measures.containerAvoid.includes(o))).toEqual(['杯']);
		}
		const door: CounterNoun = { ...tea, written: '门', gloss: 'door', measures: [{ written: '扇', variants: [], readings: [] }] };
		for (let k = 0; k < 30; k++) expect(nounChoices(door, parsed.pools.zh ?? [], () => Math.random())).not.toContain('门');
		expect(CONTAINERS).toEqual(measures.containers);
		expect(CONTAINER_AVOID).toEqual(measures.containerAvoid);
	});

	it('the pool holds the contract pool', () => {
		expect((parsed.pools.zh ?? []).map((m) => m.written)).toEqual(measures.pool.map((m) => m.simplified));
	});
});
