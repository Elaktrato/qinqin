// The conjugation drill's words (docs/contracts/conjugation/README.md, "The route"): POST
// /api/drills/conjugation/words in chunks of 500. The server conjugates; this reads its answer defensively (an
// entry or a form it cannot read is left out).

import type { api as apiFn } from '$lib/api/client';

type Api = typeof apiFn;

export const WORDS_CHUNK = 500;

/** One accepted answer of a form: written (with the word's kanji), kana, romaji. */
export interface ConjugationAnswer {
	written: string;
	reading: string;
	romaji: string;
}

export interface ConjugationWord {
	id: number;
	class: string;
	written: string;
	/** The kana reading conjugated. */
	reading: string;
	readings: { type: string; value: string }[];
	/** The families the word is drilled in, in family order. */
	families: string[];
	/** Form id → its answers, canonical first. */
	forms: Record<string, ConjugationAnswer[]>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function parseAnswers(raw: unknown): ConjugationAnswer[] {
	if (!Array.isArray(raw)) return [];
	const out: ConjugationAnswer[] = [];
	for (const a of raw) {
		if (isObject(a) && isString(a.written) && isString(a.reading) && a.written !== '' && a.reading !== '') {
			out.push({ written: a.written, reading: a.reading, romaji: isString(a.romaji) ? a.romaji : '' });
		}
	}
	return out;
}

/** parseWords reads the route's answer. */
export function parseWords(body: unknown): ConjugationWord[] {
	if (!isObject(body) || !Array.isArray(body.words)) return [];
	const out: ConjugationWord[] = [];
	for (const w of body.words) {
		if (!isObject(w) || !Number.isInteger(w.id) || !isString(w.class) || !isString(w.written) || !isString(w.reading)) continue;
		if (!Array.isArray(w.families) || !w.families.every(isString) || !isObject(w.forms)) continue;
		const forms: Record<string, ConjugationAnswer[]> = {};
		for (const [id, list] of Object.entries(w.forms)) {
			const answers = parseAnswers(list);
			if (answers.length > 0) forms[id] = answers;
		}
		const readings = Array.isArray(w.readings)
			? w.readings.filter((r): r is { type: string; value: string } => isObject(r) && isString(r.type) && isString(r.value)).map((r) => ({ type: r.type, value: r.value }))
			: [];
		out.push({ id: w.id as number, class: w.class, written: w.written, reading: w.reading, readings, families: [...w.families], forms });
	}
	return out;
}

/** loadConjugationWords asks for the words among `ids` (500 a request, one after the other), keyed by entry id. */
export async function loadConjugationWords(api: Api, ids: readonly number[]): Promise<Map<number, ConjugationWord>> {
	const out = new Map<number, ConjugationWord>();
	for (let i = 0; i < ids.length; i += WORDS_CHUNK) {
		const body = await api<unknown>('/api/drills/conjugation/words', { method: 'POST', body: { ids: ids.slice(i, i + WORDS_CHUNK) } });
		for (const w of parseWords(body)) out.set(w.id, w);
	}
	return out;
}
