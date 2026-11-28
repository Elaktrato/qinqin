// The measure-word and counter drills' data (docs/contracts/counters/README.md, "The routes"): POST
// /api/drills/measure-words/words (the nouns of the learner's decks with their measure words or counters, and the
// pools of wrong choices) in chunks of 500, and GET /api/drills/counters (the counters with the readings of every
// number asked). The server derives everything; this reads its answers defensively (what it cannot read is left out).

import type { api as apiFn } from '$lib/api/client';

type Api = typeof apiFn;

export const WORDS_CHUNK = 500;

export interface Reading {
	type: string;
	value: string;
}

/** A right answer of a noun (a measure word or a counter) or a wrong choice of a pool. */
export interface CounterMeasure {
	written: string;
	/** Other accepted spellings (traditional 隻 for 只, ヶ月 for か月). */
	variants: string[];
	/** pinyin and bopomofo, or kana and romaji. */
	readings: Reading[];
	/** A Japanese counter's id and what it counts. */
	counter?: string;
	counts?: string;
}

export interface CounterNoun {
	id: number;
	language: string;
	written: string;
	readings: Reading[];
	gloss: string;
	/** Canonical first; every one is right. */
	measures: CounterMeasure[];
	/** 个 when it is acceptable but not idiomatic (Chinese). */
	fallback: CounterMeasure | null;
	/** Shown in traditional characters (a pool's choices too). */
	traditional: boolean;
}

export interface WordsAnswer {
	words: CounterNoun[];
	/** Per language: the measure words or counters wrong choices come from. */
	pools: Record<string, CounterMeasure[]>;
}

export interface ReadingAnswer {
	reading: string;
	romaji: string;
}

/** One item of the readings drill. */
export interface NumberReadings {
	number: string;
	/** What the question shows (3本, 何本). */
	prompt: string;
	/** The kanji form (三本). */
	written: string;
	/** Canonical first, then the accepted ones. */
	answers: ReadingAnswer[];
	/** Common mistakes (wrong choices). */
	mistakes: ReadingAnswer[];
}

export interface CounterReadings {
	id: string;
	written: string;
	variants: string[];
	reading: string;
	romaji: string;
	counts: string;
	numbers: NumberReadings[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

function parseReadings(v: unknown): Reading[] {
	if (!Array.isArray(v)) return [];
	return v.filter((r): r is Reading => isObject(r) && isString(r.type) && isString(r.value)).map((r) => ({ type: r.type, value: r.value }));
}

function parseMeasure(v: unknown): CounterMeasure | null {
	if (!isObject(v) || !isString(v.written) || v.written === '') return null;
	const m: CounterMeasure = { written: v.written, variants: strings(v.variants), readings: parseReadings(v.readings) };
	if (isString(v.counter)) m.counter = v.counter;
	if (isString(v.counts)) m.counts = v.counts;
	return m;
}

function parseMeasures(v: unknown): CounterMeasure[] {
	return Array.isArray(v) ? v.map(parseMeasure).filter((m): m is CounterMeasure => m !== null) : [];
}

/** parseWords reads the answer of POST /api/drills/measure-words/words. */
export function parseWords(body: unknown): WordsAnswer {
	const out: WordsAnswer = { words: [], pools: {} };
	if (!isObject(body)) return out;
	for (const w of Array.isArray(body.words) ? body.words : []) {
		if (!isObject(w) || !isString(w.language) || !isString(w.written)) continue;
		const id = Number.isSafeInteger(w.id) ? (w.id as number) : NaN;
		const measures = parseMeasures(w.measures);
		// The fixture names a noun by key; the route by id.
		if (measures.length === 0 || (Number.isNaN(id) && !isString(w.key))) continue;
		out.words.push({
			id,
			language: w.language,
			written: w.written,
			readings: parseReadings(w.readings),
			gloss: isString(w.gloss) ? w.gloss : '',
			measures,
			fallback: parseMeasure(w.fallback),
			traditional: w.traditional === true
		});
	}
	if (isObject(body.pools)) for (const [lang, pool] of Object.entries(body.pools)) out.pools[lang] = parseMeasures(pool);
	return out;
}

function parseAnswers(v: unknown): ReadingAnswer[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter((a): a is ReadingAnswer => isObject(a) && isString(a.reading) && a.reading !== '')
		.map((a) => ({ reading: a.reading, romaji: isString(a.romaji) ? a.romaji : '' }));
}

/** parseCounters reads the answer of GET /api/drills/counters (readings.json). */
export function parseCounters(body: unknown): CounterReadings[] {
	if (!isObject(body) || !Array.isArray(body.counters)) return [];
	const out: CounterReadings[] = [];
	for (const c of body.counters) {
		if (!isObject(c) || !isString(c.id) || !isString(c.written) || !isString(c.reading) || !Array.isArray(c.numbers)) continue;
		const numbers: NumberReadings[] = [];
		for (const n of c.numbers) {
			if (!isObject(n) || !isString(n.number) || !isString(n.prompt) || !isString(n.written)) continue;
			const answers = parseAnswers(n.answers);
			if (answers.length > 0) numbers.push({ number: n.number, prompt: n.prompt, written: n.written, answers, mistakes: parseAnswers(n.mistakes) });
		}
		if (numbers.length > 0) {
			out.push({
				id: c.id,
				written: c.written,
				variants: strings(c.variants),
				reading: c.reading,
				romaji: isString(c.romaji) ? c.romaji : '',
				counts: isString(c.counts) ? c.counts : '',
				numbers
			});
		}
	}
	return out;
}

/** loadCounterNouns asks for the nouns among `ids` (500 a request, one after the other). */
export async function loadCounterNouns(api: Api, ids: readonly number[]): Promise<WordsAnswer> {
	const out: WordsAnswer = { words: [], pools: {} };
	for (let i = 0; i < ids.length; i += WORDS_CHUNK) {
		const part = parseWords(await api<unknown>('/api/drills/measure-words/words', { method: 'POST', body: { ids: ids.slice(i, i + WORDS_CHUNK) } }));
		out.words.push(...part.words);
		Object.assign(out.pools, part.pools);
	}
	return out;
}

/** loadCounterReadings reads the counters table's readings. */
export async function loadCounterReadings(api: Api): Promise<CounterReadings[]> {
	return parseCounters(await api<unknown>('/api/drills/counters'));
}
