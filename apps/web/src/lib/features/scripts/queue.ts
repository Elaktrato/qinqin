// What to ask next and how to ask it: pure, with the random source passed in (tests pass a seeded one).

import { composeSyllable, FINALS, INITIALS, MEDIALS, romanSyllable } from './hangul';
import { isDue, type ItemState } from './progress';
import type { Mode, Question, ScriptItem, ScriptSystem, ScriptWord } from './types';

export type Rng = () => number;

export const ROUND_SIZE = 10;
/** At most this many items never seen before in one round. */
export const NEW_PER_ROUND = 5;
const OPTIONS = 4;

/** mulberry32: a small seeded random source for tests. */
export function seeded(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** shuffle returns a shuffled copy (Fisher–Yates). */
export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * pickIds chooses what a round asks, from ids in their learning order: the due ones first (the longest
 * overdue first), then new ones (at most `newLimit`, in order), then the weakest of the rest. The result is
 * shuffled so new items are not always last.
 */
export function pickIds(
	ids: readonly string[],
	map: ReadonlyMap<string, ItemState>,
	now: number,
	count: number,
	newLimit: number,
	rng: Rng
): string[] {
	const due = ids.filter((id) => isDue(map.get(id), now)).sort((a, b) => map.get(a)!.dueAt - map.get(b)!.dueAt);
	const unseen = ids.filter((id) => !map.has(id));
	const newN = Math.min(newLimit, unseen.length, count);
	const chosen = [...due.slice(0, count - newN), ...unseen.slice(0, newN)];
	if (chosen.length < count) {
		const taken = new Set(chosen);
		const rest = ids
			.filter((id) => map.has(id) && !taken.has(id))
			.sort((a, b) => map.get(a)!.box - map.get(b)!.box || map.get(a)!.lastAt - map.get(b)!.lastAt);
		for (const id of rest) if (chosen.length < count) chosen.push(id);
	}
	if (chosen.length < count) {
		const taken = new Set(chosen);
		for (const id of unseen) if (chosen.length < count && !taken.has(id)) chosen.push(id);
	}
	return shuffle(chosen, rng);
}

/** shows is the text a chart cell and a prompt show for an item: upper and lower case together for a cased letter. */
export function shows(item: ScriptItem): string {
	return item.lower === undefined ? item.glyph : `${item.glyph} ${item.lower}`;
}

function confusable(a: ScriptItem, b: ScriptItem): boolean {
	return a.id === b.id || a.sounds.some((s) => b.sounds.includes(s));
}

/**
 * distractors: items that cannot be mistaken for the answer by their sound, preferring the same chart group
 * (the ones a learner mixes up). No two share a sound with each other either.
 */
export function distractors(answer: ScriptItem, pool: readonly ScriptItem[], n: number, rng: Rng): ScriptItem[] {
	const ok = pool.filter((p) => !confusable(answer, p));
	const same = shuffle(ok.filter((p) => p.group === answer.group), rng);
	const other = shuffle(ok.filter((p) => p.group !== answer.group), rng);
	const out: ScriptItem[] = [];
	for (const p of [...same, ...other]) {
		if (out.length >= n) break;
		if (!out.some((q) => confusable(p, q))) out.push(p);
	}
	return out;
}

/** itemQuestion asks about one chart item in a recognise, recall or type round. */
export function itemQuestion(system: ScriptSystem, mode: Exclude<Mode, 'read'>, item: ScriptItem, rng: Rng): Question {
	const base = { mode, system: system.id, itemId: item.id };
	if (mode === 'recognise') {
		const options = shuffle([item, ...distractors(item, system.items, OPTIONS - 1, rng)], rng).map((i) => i.roman);
		return { ...base, prompt: shows(item), speak: item.sound, options, answer: item.roman, accepts: [item.roman] };
	}
	if (mode === 'recall') {
		const options = shuffle([item, ...distractors(item, system.items, OPTIONS - 1, rng)], rng).map(shows);
		return { ...base, prompt: item.roman, speak: item.sound, options, answer: shows(item), accepts: [shows(item)] };
	}
	const accepts = item.lower === undefined ? [item.glyph] : [item.glyph, item.lower];
	return { ...base, prompt: item.roman, speak: item.sound, options: [], answer: accepts[accepts.length - 1], accepts, ...(item.key === undefined ? {} : { key: item.key }) };
}

export function wordId(system: ScriptSystem, word: ScriptWord): string {
	return `${system.id}:word:${word.text}`;
}

/** wordQuestion: read a short word, choose its sound among other words' sounds. */
export function wordQuestion(system: ScriptSystem, word: ScriptWord, rng: Rng): Question {
	const others = shuffle(
		system.words.filter((w) => w.roman !== word.roman),
		rng
	);
	// Prefer the same length (the same number of letters in the reading), so the options look alike.
	const near = others.filter((w) => w.roman.length === word.roman.length);
	const options: string[] = [];
	for (const w of [...near, ...others]) {
		if (options.length >= OPTIONS - 1) break;
		if (!options.includes(w.roman)) options.push(w.roman);
	}
	return {
		mode: 'read',
		system: system.id,
		itemId: wordId(system, word),
		prompt: word.text,
		speak: word.text,
		options: shuffle([word.roman, ...options], rng),
		answer: word.roman,
		accepts: [word.roman],
		gloss: word.gloss
	};
}

const COMMON_FINALS = [...'ㄱㄴㄹㅁㅂㅇ'];
const FIRST_INITIALS = [...'ㄱㄴㅁㅇ'];
const FIRST_MEDIALS = [...'ㅏㅣㅗㅜ'];

/** A random syllable block from the jamo the learner has seen (the first four of each kind when too few). */
function randomSyllable(seen: ReadonlySet<string>, rng: Rng): string {
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
	const known = (list: readonly string[], first: readonly string[]) => {
		const k = list.filter((j) => seen.has(`hangul:${j}`));
		return k.length >= 3 ? k : first;
	};
	const initial = pick(known(INITIALS, FIRST_INITIALS));
	const medial = pick(known(MEDIALS, FIRST_MEDIALS));
	const finals = known(FINALS, COMMON_FINALS).filter((f) => COMMON_FINALS.includes(f));
	const final = rng() < 0.5 || finals.length === 0 ? null : pick(finals);
	return composeSyllable(initial, medial, final);
}

/** syllableQuestion: read one Hangul block built from jamo the learner knows. */
export function syllableQuestion(system: ScriptSystem, seen: ReadonlySet<string>, rng: Rng): Question {
	const text = randomSyllable(seen, rng);
	const answer = romanSyllable(text)!;
	const options = new Set<string>([answer]);
	for (let guard = 0; options.size < OPTIONS && guard < 50; guard++) {
		const r = romanSyllable(randomSyllable(seen, rng));
		if (r !== null) options.add(r);
	}
	return {
		mode: 'read',
		system: system.id,
		itemId: `${system.id}:syllable:${text}`,
		prompt: text,
		speak: text,
		options: shuffle([...options], rng),
		answer,
		accepts: [answer]
	};
}

/** The question ids a read round may count for the word list: the words in the chart's order. */
export function readIds(system: ScriptSystem): string[] {
	return system.words.map((w) => wordId(system, w));
}

/**
 * buildRound: the questions of one round. Recognise, recall and type ask chart items; read asks example words
 * (and, for Hangul, half of it blocks built from the learner's jamo).
 */
export function buildRound(
	system: ScriptSystem,
	mode: Mode,
	map: ReadonlyMap<string, ItemState>,
	now: number,
	rng: Rng,
	size = ROUND_SIZE
): Question[] {
	if (mode !== 'read') {
		const ids = pickIds(system.items.map((i) => i.id), map, now, size, NEW_PER_ROUND, rng);
		return ids.map((id) => itemQuestion(system, mode, system.items.find((i) => i.id === id)!, rng));
	}
	const blocks = system.id === 'hangul' ? Math.floor(size / 2) : 0;
	const wordIds = pickIds(readIds(system), map, now, size - blocks, NEW_PER_ROUND, rng);
	const words = wordIds.map((id) => wordQuestion(system, system.words.find((w) => wordId(system, w) === id)!, rng));
	const seen = new Set([...map.keys()].filter((k) => !k.includes(':word:') && !k.includes(':syllable:')));
	const syllables = Array.from({ length: blocks }, () => syllableQuestion(system, seen, rng));
	return shuffle([...words, ...syllables], rng);
}
