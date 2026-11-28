// The look-alike drill's rules (#228; docs/contracts/lookalikes/): a set's key is its members in order (未末); the set
// files (lookAlikes/data, written for the project, CC BY 4.0) and their first problem; which sets a learner practises;
// the mode of a question, the word with a gap of a choose question and an answer's grade and event payload.

/** The drill id (docs/contracts/drills/). */
export const LOOK_ALIKES_DRILL = 'look-alikes';

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 5;

/** The project's credit, carried by every set file. */
export const PROJECT_CREDIT = 'qinqin contributors, CC BY 4.0';

export type LookAlikeMode = 'recognise' | 'choose';
export const LOOK_ALIKE_MODES: readonly LookAlikeMode[] = ['recognise', 'choose'];

export type SetsLanguage = 'zh' | 'ja';
export type ChineseScript = 'Hans' | 'Hant';

/** A Chinese character: its readings (pinyin with its bopomofo, in the same order), meaning, strokes, example. */
export interface HanziCharacter {
	kind: 'hanzi';
	pinyin: string[];
	bopomofo: string[];
	meaning: string;
	strokes: number;
	example: { word: string; hant?: string; pinyin: string; bopomofo: string; meaning: string };
}

/** A Japanese kanji: its kana readings (on in katakana, kun in hiragana), meaning, strokes, example. */
export interface KanjiCharacter {
	kind: 'kanji';
	readings: string[];
	meaning: string;
	strokes: number;
	example: { word: string; reading: string; meaning: string };
}

/** A kana: its script, romaji, the same sound in the other script, and an example word. */
export interface KanaCharacter {
	kind: 'kana';
	script: 'hiragana' | 'katakana';
	romaji: string;
	pair: string;
	example: { word: string; romaji: string; meaning: string };
}

export type LookAlikeCharacter = HanziCharacter | KanjiCharacter | KanaCharacter;

export interface LookAlikeSet {
	/** The drill item: the members in order. */
	key: string;
	members: string[];
	/** Chinese only: a set of one script; absent, both. */
	script?: ChineseScript;
	/** What to look at, per member. */
	notes: Record<string, string>;
	/** The strokes (0-based, in stroke order) that make the difference, per member; absent: none. */
	marks: Record<string, number[]>;
}

export interface SetsFile {
	language: SetsLanguage;
	characters: Record<string, LookAlikeCharacter>;
	sets: LookAlikeSet[];
}

export interface SetsProblem {
	code: string;
	path: string;
}

const HAN = /^\p{Script=Han}$/u;
const HIRAGANA = /^\p{Script=Hiragana}$/u;
const KATAKANA = /^\p{Script=Katakana}$/u;
// Kana letters only: the prolonged sound mark ー and the middle dot are Common, iteration marks are excluded.
const KANA_LETTER = /^[ぁ-ゖァ-ヺ]$/u;
const ROMAJI = /^[a-zāīūēō]+$/iu;
const MAX_TEXT = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v === v.trim() && [...v].length <= MAX_TEXT;
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText);

/** isKana: a hiragana or katakana letter. */
export function isKana(ch: string): boolean {
	return KANA_LETTER.test(ch);
}

/** isSetCharacter: one code point, a Han character or a kana letter. */
export function isSetCharacter(ch: unknown): ch is string {
	return typeof ch === 'string' && [...ch].length === 1 && (HAN.test(ch) || isKana(ch));
}

/** validSetKey: 2 to 5 distinct members, each a Han character or a kana letter. */
export function validSetKey(key: unknown): key is string {
	if (typeof key !== 'string') return false;
	const members = [...key];
	return members.length >= MIN_MEMBERS && members.length <= MAX_MEMBERS && members.every(isSetCharacter) && new Set(members).size === members.length;
}

/** The number of times `ch` occurs in `word`. */
function occurrences(word: string, ch: string): number {
	return [...word].filter((c) => c === ch).length;
}

function exampleHas(example: unknown, ch: string, ...fields: string[]): example is Record<string, string> {
	if (!isObject(example) || !isText(example.word) || occurrences(example.word, ch) !== 1) return false;
	if (example.hant !== undefined && (!isText(example.hant) || occurrences(example.hant, ch) !== 1)) return false;
	return fields.every((f) => isText(example[f]));
}

function characterProblem(language: SetsLanguage, ch: string, c: unknown): string | null {
	if (!isSetCharacter(ch) || !isObject(c)) return 'bad-character';
	if (isKana(ch)) {
		if (language !== 'ja') return 'bad-character';
		const script = HIRAGANA.test(ch) ? 'hiragana' : 'katakana';
		const other = script === 'hiragana' ? KATAKANA : HIRAGANA;
		if (c.script !== script || !isText(c.romaji) || !ROMAJI.test(c.romaji) || typeof c.pair !== 'string' || !isKana(c.pair) || !other.test(c.pair)) return 'bad-kana';
		return exampleHas(c.example, ch, 'romaji', 'meaning') ? null : 'bad-example';
	}
	if (language === 'zh') {
		if (!texts(c.pinyin) || !texts(c.bopomofo) || c.pinyin.length !== c.bopomofo.length) return 'bad-reading';
	} else if (!texts(c.readings)) return 'bad-reading';
	if (!isText(c.meaning)) return 'bad-meaning';
	if (!Number.isInteger(c.strokes) || (c.strokes as number) < 1 || (c.strokes as number) > 64) return 'bad-strokes';
	const fields = language === 'zh' ? ['pinyin', 'bopomofo', 'meaning'] : ['reading', 'meaning'];
	return exampleHas(c.example, ch, ...fields) ? null : 'bad-example';
}

function marksProblem(marks: unknown, members: readonly string[], characters: Record<string, unknown>): boolean {
	if (!isObject(marks)) return true;
	for (const [m, strokes] of Object.entries(marks)) {
		if (!members.includes(m) || !Array.isArray(strokes)) return true;
		const c = characters[m] as Record<string, unknown>;
		const count = isKana(m) ? 0 : (c.strokes as number);
		for (let i = 0; i < strokes.length; i++) {
			const s = strokes[i];
			if (!Number.isInteger(s) || s < 0 || s >= count || (i > 0 && s <= strokes[i - 1])) return true;
		}
	}
	return false;
}

function setProblem(language: SetsLanguage, s: unknown, characters: Record<string, unknown>, seen: Set<string>): string | null {
	if (!isObject(s) || !Array.isArray(s.members) || !s.members.every((m) => typeof m === 'string') || !validSetKey(s.members.join('')) || s.members.length !== [...s.members.join('')].length) {
		return 'bad-members';
	}
	const members = s.members as string[];
	if (!members.every((m) => Object.hasOwn(characters, m))) return 'unknown-character';
	const sorted = [...members].sort().join('');
	if (seen.has(sorted)) return 'duplicate-set';
	seen.add(sorted);
	if (s.script !== undefined && (language !== 'zh' || (s.script !== 'Hans' && s.script !== 'Hant'))) return 'bad-script';
	if (!isObject(s.notes) || Object.keys(s.notes).length !== members.length || !members.every((m) => isText((s.notes as Record<string, unknown>)[m]))) return 'bad-note';
	if (marksProblem(s.marks, members, characters)) return 'bad-marks';
	return null;
}

/** setsProblem: the first problem of a set file, or null (docs/contracts/lookalikes/README.md, "The set files"). */
export function setsProblem(file: unknown): SetsProblem | null {
	if (!isObject(file)) return { code: 'not-an-object', path: '' };
	if (file.version !== 1) return { code: 'bad-version', path: 'version' };
	if (file.language !== 'zh' && file.language !== 'ja') return { code: 'bad-language', path: 'language' };
	if (file.license !== 'CC-BY-4.0') return { code: 'bad-license', path: 'license' };
	if (typeof file.attribution !== 'string' || !file.attribution.includes(PROJECT_CREDIT)) return { code: 'bad-attribution', path: 'attribution' };
	if (!isObject(file.characters)) return { code: 'no-characters', path: 'characters' };
	if (!Array.isArray(file.sets) || file.sets.length === 0) return { code: 'no-sets', path: 'sets' };
	const language = file.language;
	const characters = file.characters;
	for (const [ch, c] of Object.entries(characters)) {
		const code = characterProblem(language, ch, c);
		if (code !== null) return { code, path: `characters.${ch}` };
	}
	const seen = new Set<string>();
	const used = new Set<string>();
	for (let i = 0; i < file.sets.length; i++) {
		const code = setProblem(language, file.sets[i], characters, seen);
		if (code !== null) return { code, path: `sets.${i}` };
		for (const m of (file.sets[i] as { members: string[] }).members) used.add(m);
	}
	for (const ch of Object.keys(characters)) if (!used.has(ch)) return { code: 'unused-character', path: `characters.${ch}` };
	return null;
}

function characterOf(ch: string, c: Record<string, unknown>, language: SetsLanguage): LookAlikeCharacter {
	const example = c.example as Record<string, string>;
	if (isKana(ch)) {
		return {
			kind: 'kana',
			script: c.script as KanaCharacter['script'],
			romaji: c.romaji as string,
			pair: c.pair as string,
			example: { word: example.word, romaji: example.romaji, meaning: example.meaning }
		};
	}
	if (language === 'zh') {
		const out: HanziCharacter = {
			kind: 'hanzi',
			pinyin: [...(c.pinyin as string[])],
			bopomofo: [...(c.bopomofo as string[])],
			meaning: c.meaning as string,
			strokes: c.strokes as number,
			example: { word: example.word, pinyin: example.pinyin, bopomofo: example.bopomofo, meaning: example.meaning }
		};
		if (example.hant !== undefined) out.example.hant = example.hant;
		return out;
	}
	return {
		kind: 'kanji',
		readings: [...(c.readings as string[])],
		meaning: c.meaning as string,
		strokes: c.strokes as number,
		example: { word: example.word, reading: example.reading, meaning: example.meaning }
	};
}

/** parseSetsFile: a set file without problems, or null. */
export function parseSetsFile(file: unknown): SetsFile | null {
	if (setsProblem(file) !== null) return null;
	const f = file as { language: SetsLanguage; characters: Record<string, Record<string, unknown>>; sets: Record<string, unknown>[] };
	const characters: Record<string, LookAlikeCharacter> = {};
	for (const [ch, c] of Object.entries(f.characters)) characters[ch] = characterOf(ch, c, f.language);
	const sets = f.sets.map((s): LookAlikeSet => {
		const members = [...(s.members as string[])];
		const marks: Record<string, number[]> = {};
		for (const [m, strokes] of Object.entries(s.marks as Record<string, number[]>)) if (strokes.length > 0) marks[m] = [...strokes];
		const set: LookAlikeSet = { key: members.join(''), members, notes: { ...(s.notes as Record<string, string>) }, marks };
		if (s.script !== undefined) set.script = s.script as ChineseScript;
		return set;
	});
	return { language: f.language, characters, sets };
}

/** The primary subtag of a language code (`zh-Hant` → `zh`). */
function primary(language: string): string {
	return language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** chineseScript: the script a Chinese workspace reads (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO` → Hant), else Hans. */
export function chineseScript(language: string): ChineseScript {
	return /^zh[-_](hant|tw|hk|mo)\b/i.test(language.trim()) ? 'Hant' : 'Hans';
}

/** isKanaSet: a set with a kana member (Japanese: always practised). */
export function isKanaSet(set: Pick<LookAlikeSet, 'members'>): boolean {
	return set.members.some(isKana);
}

/**
 * candidateSets: the sets a learner practises, in the order they are introduced. Japanese kana sets always, first, in
 * file order; then each set with a member in the studied written forms (in the order of their first review, a
 * character at a time), once; a Chinese set only in the workspace's script (`Hans`/`Hant` or unmarked).
 */
export function candidateSets(file: SetsFile, language: string, studied: readonly string[]): LookAlikeSet[] {
	if (primary(language) !== file.language) return [];
	const script = chineseScript(language);
	const usable = file.sets.filter((s) => s.script === undefined || s.script === script);
	const out: LookAlikeSet[] = [];
	const taken = new Set<string>();
	const take = (s: LookAlikeSet) => {
		if (taken.has(s.key)) return;
		taken.add(s.key);
		out.push(s);
	};
	if (file.language === 'ja') for (const s of usable) if (isKanaSet(s)) take(s);
	const byMember = new Map<string, LookAlikeSet[]>();
	for (const s of usable) for (const m of s.members) byMember.set(m, [...(byMember.get(m) ?? []), s]);
	for (const written of studied) for (const ch of written) for (const s of byMember.get(ch) ?? []) take(s);
	return out;
}

/** modeFor: recognise first, then the two modes take turns with the item's number of answers. */
export function modeFor(answers: number): LookAlikeMode {
	return answers % 2 === 0 ? 'recognise' : 'choose';
}

/** The example word a workspace reads: the traditional form in a Hant workspace where there is one. */
export function exampleWord(c: LookAlikeCharacter, language: string): string {
	if (c.kind === 'hanzi' && chineseScript(language) === 'Hant' && primary(language) === 'zh') return c.example.hant ?? c.example.word;
	return c.example.word;
}

/** The gap a choose question shows in place of the character. */
export const GAP = '＿';

/** gapPrompt: the member's example word with the member left out, and its meaning (no reading). */
export function gapPrompt(file: SetsFile, member: string, language: string): { gap: string; meaning: string } {
	const c = file.characters[member];
	return { gap: [...exampleWord(c, language)].map((ch) => (ch === member ? GAP : ch)).join(''), meaning: c.example.meaning };
}

export interface LookAlikePayload {
	item: string;
	mode: LookAlikeMode;
	grade: 1 | 3;
	asked: string;
	given: string;
}

/**
 * answerOf: a question of set `item` asked `asked` and the learner gave `given`: right is Good (3), wrong Again (1);
 * the event's payload names the set, the mode, the grade, then the two characters (docs/contracts/lookalikes/). Null
 * when the mode is not the drill's or a character is not a member.
 */
export function answerOf(item: string, mode: string, asked: string, given: string): { right: boolean; grade: 1 | 3; payload: LookAlikePayload } | null {
	if (!validSetKey(item) || !(LOOK_ALIKE_MODES as readonly string[]).includes(mode)) return null;
	const members = [...item];
	if (!members.includes(asked) || !members.includes(given)) return null;
	const right = asked === given;
	const grade = right ? 3 : 1;
	return { right, grade, payload: { item, mode: mode as LookAlikeMode, grade, asked, given } };
}
