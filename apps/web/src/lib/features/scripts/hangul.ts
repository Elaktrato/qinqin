// Hangul syllable blocks: initial consonant + vowel (+ final consonant), composed by the Unicode formula
// (U+AC00 + (initial * 21 + medial) * 28 + final). Pure; used by the chart's building view and the read mode.

/** The 19 initials, the 21 vowels and the 27 finals in Unicode order (compatibility jamo). */
export const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
export const MEDIALS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
export const FINALS = [...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

const INITIAL_ROMAN = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL_ROMAN = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// The sound of a final in the syllable's last place (revised romanisation); a cluster is read by its first sound.
const FINAL_ROMAN = ['k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

const BASE = 0xac00;

export interface Parts {
	initial: string;
	medial: string;
	final: string | null;
}

/** composeSyllable builds one block; it throws when a jamo is not allowed in its place. */
export function composeSyllable(initial: string, medial: string, final: string | null = null): string {
	const i = INITIALS.indexOf(initial);
	const m = MEDIALS.indexOf(medial);
	const f = final === null ? 0 : FINALS.indexOf(final) + 1;
	if (i < 0 || m < 0 || (final !== null && f === 0)) {
		throw new Error(`not a Hangul syllable: ${initial} ${medial} ${final ?? ''}`);
	}
	return String.fromCodePoint(BASE + (i * 21 + m) * 28 + f);
}

/** decompose splits one syllable block into its jamo; null for anything else. */
export function decompose(text: string): Parts | null {
	const chars = [...text];
	if (chars.length !== 1) return null;
	const n = chars[0].codePointAt(0)! - BASE;
	if (n < 0 || n >= 19 * 21 * 28) return null;
	const f = n % 28;
	const m = Math.floor(n / 28) % 21;
	const i = Math.floor(n / (28 * 21));
	return { initial: INITIALS[i], medial: MEDIALS[m], final: f === 0 ? null : FINALS[f - 1] };
}

/** finalRoman: how a final consonant sounds at the end of a syllable. */
export function finalRoman(final: string): string {
	return FINAL_ROMAN[FINALS.indexOf(final)];
}

/** romanSyllable: the revised romanisation of one block read alone (no sound changes between blocks); null for non-syllables. */
export function romanSyllable(text: string): string | null {
	const p = decompose(text);
	if (p === null) return null;
	return INITIAL_ROMAN[INITIALS.indexOf(p.initial)] + MEDIAL_ROMAN[MEDIALS.indexOf(p.medial)] + (p.final === null ? '' : finalRoman(p.final));
}
