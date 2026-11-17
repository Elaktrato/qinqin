// Furigana for a dictionary match: align the entry's kana reading with the
// kanji of the word. Returns null on any doubt - no reading is better than
// a wrong one (docs/contracts/reader/furigana-align.json).

export interface FuriganaPiece {
	text: string;
	rt?: string;
}

// Han plus the iteration mark and the shime mark, which sit inside kanji runs.
const KANJI = /[\p{Script=Han}々〆]/u;
const KANA_READING = /^[ぁ-ゖー]+$/u;

/** Katakana to hiragana; the long-vowel mark and everything else stay as is. */
export function fold(text: string): string {
	let out = '';
	for (const ch of text) {
		const c = ch.codePointAt(0) as number;
		out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
	}
	return out;
}

interface Run {
	kanji: boolean;
	text: string;
}

function runsOf(text: string): Run[] {
	const runs: Run[] = [];
	for (const ch of text) {
		const kanji = KANJI.test(ch);
		const last = runs[runs.length - 1];
		if (last && last.kanji === kanji) last.text += ch;
		else runs.push({ kanji, text: ch });
	}
	return runs;
}

/** Every way to split `reading` over the runs, at most two are collected. */
function splits(runs: Run[], reading: string[]): string[][] {
	const found: string[][] = [];
	const walk = (ri: number, pos: number, acc: string[]): void => {
		if (found.length > 1) return;
		if (ri === runs.length) {
			if (pos === reading.length) found.push(acc);
			return;
		}
		const run = runs[ri];
		if (!run.kanji) {
			const lit = Array.from(fold(run.text));
			for (let i = 0; i < lit.length; i++) if (reading[pos + i] !== lit[i]) return;
			walk(ri + 1, pos + lit.length, [...acc, '']);
			return;
		}
		for (let end = pos + 1; end <= reading.length; end++) {
			walk(ri + 1, end, [...acc, reading.slice(pos, end).join('')]);
		}
	};
	walk(0, 0, []);
	return found;
}

/**
 * alignFurigana puts `reading` over the kanji of `surface`. The pattern
 * comes from the dictionary form `lemma` (kanji run = one or more kana,
 * kana run = itself); an inflected surface keeps the lemma's leading
 * characters, so the readings apply to the common prefix and the rest
 * stays plain. Null when the surface has no kanji, a kanji of the lemma
 * or the surface lies outside the common prefix, the reading is not kana,
 * or the reading splits in more than one way.
 */
export function alignFurigana(surface: string, lemma: string, reading: string): FuriganaPiece[] | null {
	if (!KANJI.test(surface) || !KANJI.test(lemma)) return null;
	const kana = fold(reading);
	if (!KANA_READING.test(kana)) return null;

	// 来る is read き/こ/く by inflection: the stem reading is not the lemma's.
	if (surface !== lemma && /[来來]る$/.test(lemma)) return null;

	const s = Array.from(surface);
	const l = Array.from(lemma);
	let common = 0;
	while (common < s.length && common < l.length && s[common] === l[common]) common++;
	// Every kanji of both words must be inside the shared prefix.
	if (s.slice(common).some((c) => KANJI.test(c)) || l.slice(common).some((c) => KANJI.test(c))) return null;

	// The lemma's tail past the prefix is dictionary-form kana (る of 食べる):
	// it takes part in matching the reading, but not in the output.
	const runs = runsOf(lemma);
	const found = splits(runs, Array.from(kana));
	if (found.length !== 1) return null;

	const pieces: FuriganaPiece[] = [];
	let used = 0;
	const push = (text: string, rt?: string): void => {
		if (text === '') return;
		const last = pieces[pieces.length - 1];
		if (rt === undefined && last && last.rt === undefined) last.text += text;
		else pieces.push(rt === undefined ? { text } : { text, rt });
	};
	runs.forEach((run, i) => {
		const chars = Array.from(run.text);
		const inPrefix = chars.slice(0, Math.max(0, Math.min(chars.length, common - used)));
		used += chars.length;
		if (run.kanji) push(run.text, found[0][i]);
		else push(inPrefix.join(''));
	});
	push(s.slice(common).join(''));
	return pieces;
}
