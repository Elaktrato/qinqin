// The sense display rule: the order an entry's senses are shown in, and
// which are folded behind "more". Contract: docs/contracts/senses/display.json;
// the server's lexicon.DisplaySenses implements the same rule (the one gloss
// of starter sets, frequency lists and search hits). Stored senses are never
// reordered: picture mappings and cross-references count them as stored.

export type SenseClass = 'everyday' | 'minor' | 'sensitive';
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

/** First-gloss prefixes (any case) of a CC-CEDICT line that is not an everyday meaning (书 "abbr. for 書經"). */
export const MINOR_PREFIXES = [
	'surname ',
	'japanese surname',
	'abbr. for',
	'abbr. of',
	'short for',
	'short name for',
	'variant of',
	'old variant of',
	'(old) variant of',
	'archaic variant of',
	'(archaic) variant of',
	'(old) contracted variant of',
	'euphemistic variant of',
	'erhua variant of',
	'see ',
	'also written',
	'used in',
	'(archaic)',
	'(old)',
	'(classical)',
	'old name for'
] as const;

/** JMdict sense tags of a minor sense (abbr is not one: 電話's "telephone (device)"). */
export const MINOR_TAGS = ['arch', 'obs', 'rare', 'dated', 'surname'] as const;

/** The sense tag prefix naming a reading a sense belongs to ("reading:hē"); untagged senses fit every reading. */
export const TAG_READING = 'reading:';

/** minorGloss: the gloss starts with a minor prefix, ignoring case. */
export function minorGloss(gloss: string): boolean {
	const lower = gloss.toLowerCase();
	return MINOR_PREFIXES.some((p) => lower.startsWith(p));
}

function minorSense(sense: SenseLike): boolean {
	if ((sense.tags ?? []).some((t) => (MINOR_TAGS as readonly string[]).includes(t))) return true;
	const first = sense.glosses[0];
	return first !== undefined && minorGloss(first);
}

/** readingKey: how a pin and a reading tag compare: lower case, no white space or apostrophes. */
function readingKey(reading: string): string {
	return reading.replace(/[\s'’]/gu, '').toLowerCase();
}

function ofReading(sense: SenseLike, key: string): boolean {
	const readings = (sense.tags ?? []).filter((t) => t.startsWith(TAG_READING));
	return readings.length === 0 || readings.some((t) => readingKey(t.slice(TAG_READING.length)) === key);
}

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
 * displaySenses: with a pinned reading, only the senses of that reading (and
 * those of every reading) count, unless none of them has a gloss. Each
 * sense's unmarked glosses are an everyday unit (minor for a minor sense),
 * then its marked glosses a sensitive unit (their strongest mark); every
 * everyday unit in sense order, then every minor one, then every sensitive
 * one. Sensitive units are folded unless they are all there is.
 */
export function displaySenses(senses: readonly SenseLike[], pinned?: string): SenseUnit[] {
	const key = readingKey(pinned ?? '');
	const pin = key !== '' && senses.some((s) => s.glosses.length > 0 && ofReading(s, key));
	const everyday: SenseUnit[] = [];
	const minor: SenseUnit[] = [];
	const sensitive: SenseUnit[] = [];
	senses.forEach((sense, i) => {
		if (pin && !ofReading(sense, key)) return;
		let tagMark: SenseMark | null = null;
		for (const tag of sense.tags ?? []) tagMark = stronger(tagMark, TAG_MARKS[tag] ?? null);
		const plain: SenseUnit = { sense: i, class: minorSense(sense) ? 'minor' : 'everyday', mark: null, folded: false, glosses: [] };
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
		if (plain.glosses.length > 0) (plain.class === 'minor' ? minor : everyday).push(plain);
		if (marked.glosses.length > 0) sensitive.push(marked);
	});
	if (everyday.length + minor.length > 0) for (const unit of sensitive) unit.folded = true;
	return [...everyday, ...minor, ...sensitive];
}

/** displayGloss: the first gloss of the first display unit (pinned as in displaySenses), '' without one. */
export function displayGloss(senses: readonly SenseLike[], pinned?: string): string {
	return displaySenses(senses, pinned)[0]?.glosses[0] ?? '';
}
