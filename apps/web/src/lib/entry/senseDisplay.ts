// The sense display rule: the order an entry's senses are shown in, and
// which are folded behind "more". Contract: docs/contracts/senses/display.json;
// the server's lexicon.DisplaySenses implements the same rule (the one gloss
// of starter sets, frequency lists and search hits). Stored senses are never
// reordered: picture mappings and cross-references count them as stored.

export type SenseClass = 'everyday' | 'sensitive';
export type SenseMark = 'vulg' | 'derog' | 'sl';

/** One sense as a dictionary gives it; only tags and glosses matter here. */
export interface SenseLike {
	tags?: readonly string[];
	glosses: readonly string[];
}

/** One display unit: glosses of the stored sense `sense` (an index into the input) that share a class. */
export interface SenseUnit {
	sense: number;
	class: SenseClass;
	mark: SenseMark | null;
	folded: boolean;
	glosses: string[];
}

/** Whole words (any case) that mark a gloss vulgar where the dictionary left it unmarked. */
export const EXPLICIT_WORDS = [
	'fuck',
	'fucking',
	'fucked',
	'fucker',
	'cunt',
	'dick',
	'penis',
	'vagina',
	'testicles',
	'prostitute',
	'prostitutes',
	'prostitution',
	'whore',
	'whores',
	'slut',
	'sluts',
	'porn',
	'porno',
	'pornographic',
	'pornography',
	'lewd',
	'obscene',
	'masturbate',
	'masturbation'
] as const;

/** Characters that mark a gloss vulgar wherever they appear (草 cào "variant of 肏"). */
export const VULGAR_CHARACTERS = ['肏', '屄', '屌'] as const;

const EXPLICIT = new RegExp(`\\b(?:${EXPLICIT_WORDS.join('|')})\\b`, 'i');
const NOTE = /\(([^()]*)\)/g;
const NOTE_VULGAR = /vulgar|expletive/i;
const NOTE_DEROG = /derog|pejorative|offensive/i;
const NOTE_SLANG = /slang/i;

/** JMdict sense tags that mark every gloss of their sense. */
const TAG_MARKS: Record<string, SenseMark> = { vulg: 'vulg', derog: 'derog', sl: 'sl', 'net-sl': 'sl', 'm-sl': 'sl' };

const RANK: Record<SenseMark, number> = { vulg: 3, derog: 2, sl: 1 };

function stronger(a: SenseMark | null, b: SenseMark | null): SenseMark | null {
	if (b === null) return a;
	if (a === null) return b;
	return RANK[b] > RANK[a] ? b : a;
}

function glossMark(gloss: string, tagMark: SenseMark | null): SenseMark | null {
	let mark = tagMark;
	for (const [, text] of gloss.matchAll(NOTE)) {
		if (NOTE_VULGAR.test(text)) mark = stronger(mark, 'vulg');
		else if (NOTE_DEROG.test(text)) mark = stronger(mark, 'derog');
		else if (NOTE_SLANG.test(text)) mark = stronger(mark, 'sl');
	}
	if (EXPLICIT.test(gloss) || VULGAR_CHARACTERS.some((c) => gloss.includes(c))) mark = 'vulg';
	return mark;
}

/**
 * displaySenses: each sense's unmarked glosses as an everyday unit, then its
 * marked glosses as a sensitive unit (their strongest mark); every everyday
 * unit in sense order, then every sensitive one. Sensitive units are folded
 * unless no everyday unit exists.
 */
export function displaySenses(senses: readonly SenseLike[]): SenseUnit[] {
	const everyday: SenseUnit[] = [];
	const sensitive: SenseUnit[] = [];
	senses.forEach((sense, i) => {
		let tagMark: SenseMark | null = null;
		for (const tag of sense.tags ?? []) tagMark = stronger(tagMark, TAG_MARKS[tag] ?? null);
		const plain: SenseUnit = { sense: i, class: 'everyday', mark: null, folded: false, glosses: [] };
		const marked: SenseUnit = { sense: i, class: 'sensitive', mark: null, folded: false, glosses: [] };
		for (const gloss of sense.glosses) {
			const mark = glossMark(gloss, tagMark);
			if (mark === null) {
				plain.glosses.push(gloss);
			} else {
				marked.mark = stronger(marked.mark, mark);
				marked.glosses.push(gloss);
			}
		}
		if (plain.glosses.length > 0) everyday.push(plain);
		if (marked.glosses.length > 0) sensitive.push(marked);
	});
	if (everyday.length > 0) for (const unit of sensitive) unit.folded = true;
	return [...everyday, ...sensitive];
}

/** displayGloss: the first gloss of the first display unit, '' without one. */
export function displayGloss(senses: readonly SenseLike[]): string {
	return displaySenses(senses)[0]?.glosses[0] ?? '';
}
