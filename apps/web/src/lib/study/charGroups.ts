// The character grid's pure logic: which "Group by" options a language
// offers, how the universe list splits into sections, and how the derived
// per-glyph mastery becomes one state per cell. A cell shares its score
// with its variant forms (a card written 愛 lights 爱), taking the maximum.

import type { CharRow, Scheme } from '$lib/api/types';
import { MASTERY_THRESHOLD, stageOf, type CharMastery, type MasteryStage } from './mastery';

export type Stage = MasteryStage;

// Re-exported from mastery.ts, the single source of the `learned` edge.
export { MASTERY_THRESHOLD };

// Level packs (the bundled HSK 3.0 characters and words and JLPT kanji, and any locally
// installed scheme such as JLPT vocabulary, which is not bundled) are
// offered as `scheme:` groupings; a word scheme groups the characters its
// words are written with (GET /api/schemes/{id}/characters).
export type GroupKey =
	| 'grade'
	| 'freq'
	| 'strokes'
	| 'common'
	| 'hkgrade'
	| `scheme:${number}`;

export interface GroupOption {
	key: GroupKey;
	label: string;
}

export interface Section {
	id: string;
	label: string;
	chars: CharRow[];
}

export interface CellState {
	char: CharRow;
	score: number;
	stage: Stage;
	reviewedCards: number;
}

export interface SectionStats {
	total: number;
	learned: number;
	byStage: Record<Stage, number>;
}

export type StageFilter = 'all' | 'not-started' | 'learning' | 'learned';

const JA_OPTIONS: GroupOption[] = [
	{ key: 'grade', label: 'Grade' },
	{ key: 'freq', label: 'Frequency' },
	{ key: 'strokes', label: 'Strokes' }
];

const ZH_OPTIONS: GroupOption[] = [
	{ key: 'common', label: 'Common' },
	{ key: 'hkgrade', label: 'HK primary grade' },
	{ key: 'strokes', label: 'Strokes' }
];

// The bundled level packs that are hand-written samples, not real lists.
const SAMPLE_PACK_IDS = new Set(['hsk-mini', 'jlpt-mini']);

/**
 * Bundled packs the map does not offer as a "Group by" choice because a
 * built-in grouping already shows the same sections: `joyo-grades` is the
 * built-in "Grade" (KANJIDIC2 grades 1–6 and 8). Badges, level sessions and
 * search filters still use them. Other bundled schemes (HSK, JLPT kanji,
 * `tgh-chars`) and a user's own pack are offered; removing an id here
 * re-adds its option.
 */
export const HIDDEN_GROUPING_PACK_IDS: ReadonlySet<string> = new Set(['joyo-grades']);

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * isSampleScheme recognises the bundled samples by pack id. Only a scheme
 * without a pack id falls back to the name (`hsk-mini`, "HSK mini
 * (sample)", "JLPT N5 mini (sample)"), so a user's own pack that happens
 * to be called "HSK Mini" stays visible.
 */
function isSampleScheme(scheme: Scheme): boolean {
	if (scheme.packId !== undefined) return SAMPLE_PACK_IDS.has(scheme.packId);
	const slug = scheme.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return /^(hsk|jlpt)(-n\d)?-mini(-sample)?$/.test(slug);
}

function isHiddenScheme(scheme: Scheme): boolean {
	return scheme.packId !== undefined && HIDDEN_GROUPING_PACK_IDS.has(scheme.packId);
}

/**
 * groupOptions lists the "Group by" choices for a workspace language:
 * the built-in groupings of ja or zh, then one option per installed level
 * scheme of that language, in scheme id order (the bundled samples and
 * HIDDEN_GROUPING_PACK_IDS are hidden). Schemes sharing a name (the bundled "HSK 3.0 (characters)" and
 * an older local pack of that name) are told apart by their pack id.
 * Languages not written with Han characters have none.
 */
export function groupOptions(language: string, schemes: readonly Scheme[]): GroupOption[] {
	const lang = primarySubtag(language);
	const builtIn = lang === 'ja' ? JA_OPTIONS : lang === 'zh' ? ZH_OPTIONS : null;
	if (builtIn === null) return [];
	const shown = schemes.filter((scheme) => primarySubtag(scheme.language) === lang && !isSampleScheme(scheme) && !isHiddenScheme(scheme));
	const named = new Map<string, number>();
	for (const scheme of shown) named.set(scheme.name, (named.get(scheme.name) ?? 0) + 1);
	const fromSchemes = shown.map(
		(scheme): GroupOption => ({
			key: `scheme:${scheme.id}`,
			label:
				(named.get(scheme.name) ?? 0) > 1 && scheme.packId ? `${scheme.name} · ${scheme.packId}` : scheme.name
		})
	);
	return [...builtIn.map((option) => ({ ...option })), ...fromSchemes];
}

/** A section slot before its characters are known; `rank` fixes the order. */
interface Slot {
	id: string;
	label: string;
	rank: number;
}

function isPositiveInt(value: number | undefined): value is number {
	return value !== undefined && Number.isInteger(value) && value > 0;
}

const GRADE_NAMES: Slot = { id: 'grade-names', label: 'Names (jinmeiyō, 9–10)', rank: 9 };
const GRADE_NONE: Slot = { id: 'grade-none', label: 'Not graded', rank: 99 };

function gradeSlot(row: CharRow): Slot {
	const g = row.g;
	if (isPositiveInt(g) && g <= 6) return { id: `grade-${g}`, label: `Grade ${g}`, rank: g };
	if (g === 8) return { id: 'grade-8', label: 'Secondary (grade 8)', rank: 8 };
	if (g === 9 || g === 10) return GRADE_NAMES;
	return GRADE_NONE;
}

const FREQ_BUCKET = 500;
// KANJIDIC2 ranks run 1…2501; everything above 2000 shares the last
// bucket so the lone rank 2501 does not get a one-cell section.
const FREQ_LAST_BUCKET = 5;
const FREQ_LAST: Slot = { id: 'freq-5', label: '2001–2501', rank: FREQ_LAST_BUCKET };

function freqSlot(row: CharRow): Slot {
	const f = row.f;
	if (!isPositiveInt(f)) return { id: 'freq-none', label: 'Not ranked', rank: Number.MAX_SAFE_INTEGER };
	const bucket = Math.ceil(f / FREQ_BUCKET);
	if (bucket >= FREQ_LAST_BUCKET) return FREQ_LAST;
	const from = (bucket - 1) * FREQ_BUCKET + 1;
	const to = bucket * FREQ_BUCKET;
	return { id: `freq-${bucket}`, label: `${from}–${to}`, rank: bucket };
}

function strokesSlot(row: CharRow): Slot {
	const s = row.s;
	if (!isPositiveInt(s)) {
		return { id: 'strokes-none', label: 'Stroke count unknown', rank: Number.MAX_SAFE_INTEGER };
	}
	return { id: `strokes-${s}`, label: s === 1 ? '1 stroke' : `${s} strokes`, rank: s };
}

function commonSlot(row: CharRow): Slot {
	if (row.b === 1) return { id: 'common-gb1', label: 'GB2312 level 1 (common)', rank: 1 };
	if (row.b === 2) return { id: 'common-gb2', label: 'GB2312 level 2', rank: 2 };
	if (row.t === 1) return { id: 'common-standard', label: 'Other standard characters', rank: 3 };
	return { id: 'common-other', label: 'Other characters in the dictionary', rank: 4 };
}

function hkgradeSlot(row: CharRow): Slot {
	const h = row.h;
	if (isPositiveInt(h) && h <= 6) {
		return { id: `hkgrade-${h}`, label: `Primary grade ${h} (Hong Kong)`, rank: h };
	}
	return { id: 'hkgrade-none', label: 'No grade', rank: 99 };
}

/**
 * SchemeLevelMembers is one level of a scheme grouping, in level order:
 * the Han characters that belong to it. Sections are keyed by `levelId`,
 * so two levels with the same name stay apart.
 */
export interface SchemeLevelMembers {
	levelId: number;
	name: string;
	chars: ReadonlySet<string>;
}

function schemeSlotter(members: readonly SchemeLevelMembers[] | undefined): (row: CharRow) => Slot {
	const levels = (members ?? []).map((level, index) => ({
		slot: { id: `level-${level.levelId}`, label: level.name, rank: index } satisfies Slot,
		set: level.chars
	}));
	const outside: Slot = { id: 'level-none', label: 'Not in this scheme', rank: Number.MAX_SAFE_INTEGER };
	return (row) => {
		// The glyph itself decides first; a variant (a traditional form in
		// a list written in traditional) only when the glyph is in no level.
		for (const level of levels) if (level.set.has(row.c)) return level.slot;
		for (const form of row.v ?? []) {
			for (const level of levels) if (level.set.has(form)) return level.slot;
		}
		return outside;
	};
}

function slotterFor(
	key: GroupKey,
	members: readonly SchemeLevelMembers[] | undefined
): (row: CharRow) => Slot {
	switch (key) {
		case 'grade':
			return gradeSlot;
		case 'freq':
			return freqSlot;
		case 'strokes':
			return strokesSlot;
		case 'common':
			return commonSlot;
		case 'hkgrade':
			return hkgradeSlot;
		default:
			return schemeSlotter(members);
	}
}

/**
 * buildSections splits the characters into the grouping's sections in
 * their fixed order. Every character lands in exactly one section — the
 * grouping's "other" section catches missing or unexpected values — and
 * keeps its input order there. Empty sections are omitted. For a scheme
 * grouping, `schemeMembers` lists the levels in level order with their
 * member glyphs (see `fetchSchemeCharacters`); a glyph in several levels
 * lands in the first.
 */
export function buildSections(
	chars: readonly CharRow[],
	key: GroupKey,
	schemeMembers?: readonly SchemeLevelMembers[]
): Section[] {
	const slotOf = slotterFor(key, schemeMembers);
	const byId = new Map<string, { slot: Slot; chars: CharRow[] }>();
	for (const row of chars) {
		const slot = slotOf(row);
		const bucket = byId.get(slot.id);
		if (bucket === undefined) {
			byId.set(slot.id, { slot, chars: [row] });
		} else {
			bucket.chars.push(row);
		}
	}
	return [...byId.values()]
		.sort((a, b) => a.slot.rank - b.slot.rank)
		.map(({ slot, chars: members }) => ({ id: slot.id, label: slot.label, chars: members }));
}

/**
 * masteryGlyphs lists every glyph the cells need scored, variants
 * included, each once: the input for `masteryForChars`.
 */
export function masteryGlyphs(chars: readonly CharRow[]): string[] {
	const seen = new Set<string>();
	for (const row of chars) {
		seen.add(row.c);
		for (const form of row.v ?? []) seen.add(form);
	}
	return [...seen];
}

/**
 * cellStates gives each character the best mastery over its own glyph
 * and its variant forms: the maximum, never the sum, so studying both
 * forms does not inflate the cell. The reviewed-card count is the one of
 * the form that set the score.
 */
export function cellStates(
	chars: readonly CharRow[],
	mastery: ReadonlyMap<string, CharMastery>
): CellState[] {
	return chars.map((row) => {
		let score = 0;
		let reviewedCards = 0;
		for (const form of [row.c, ...(row.v ?? [])]) {
			const m = mastery.get(form);
			if (m === undefined) continue;
			if (m.score > score || (m.score === score && m.reviewedCards > reviewedCards)) {
				score = m.score;
				reviewedCards = m.reviewedCards;
			}
		}
		return { char: row, score, stage: stageOf(score), reviewedCards };
	});
}

/** sectionStats counts a section's cells per stage and those learned. */
export function sectionStats(cells: readonly CellState[]): SectionStats {
	const byStage: Record<Stage, number> = { unknown: 0, fresh: 0, learning: 0, mature: 0, learned: 0 };
	let learned = 0;
	for (const cell of cells) {
		byStage[cell.stage] += 1;
		if (cell.score >= MASTERY_THRESHOLD) learned += 1;
	}
	return { total: cells.length, learned, byStage };
}

const LATIN_MARKS = /(\p{Script=Latin})\p{M}+/gu;
const HIRAGANA = /[ぁ-ゖ]/g;
const FIELD_SEPARATOR = '\u0000';

/**
 * fold makes text comparable for search: NFKC, lower case, tone marks and
 * other accents stripped from Latin letters only (so "hao" finds "hǎo"
 * while kana keep their dakuten), and hiragana folded to katakana.
 */
function fold(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.normalize('NFD')
		.replace(LATIN_MARKS, '$1')
		.normalize('NFC')
		.replace(HIRAGANA, (kana) => String.fromCharCode(kana.charCodeAt(0) + 0x60));
}

// The folded search text per row, computed once: a keystroke then folds
// only the query, not 13k rows × 4 fields.
const haystacks = new WeakMap<CharRow, string>();

function haystackOf(row: CharRow): string {
	let text = haystacks.get(row);
	if (text === undefined) {
		const fields = [row.c, ...(row.v ?? []), row.r ?? '', row.m ?? ''];
		text = fold(fields.join(FIELD_SEPARATOR));
		haystacks.set(row, text);
	}
	return text;
}

function matchesStage(cell: CellState, filter: StageFilter): boolean {
	switch (filter) {
		case 'not-started':
			return cell.stage === 'unknown';
		case 'learning':
			return cell.stage !== 'unknown' && cell.stage !== 'learned';
		case 'learned':
			return cell.stage === 'learned';
		default:
			return true;
	}
}

/**
 * filterCells keeps the cells of a stage filter ("learning" is every
 * started but not yet learned stage) whose glyph, variant, reading or
 * gloss contains the query. Both sides are folded (see `fold`): case,
 * NFKC, Latin tone marks and hiragana/katakana do not matter. A blank
 * query matches everything.
 */
export function filterCells(
	cells: readonly CellState[],
	filter: StageFilter,
	query: string
): CellState[] {
	const needle = fold(query.trim()).replaceAll(FIELD_SEPARATOR, '');
	return cells.filter((cell) => {
		if (!matchesStage(cell, filter)) return false;
		if (needle === '') return true;
		return haystackOf(cell.char).includes(needle);
	});
}

// The share of characters that must lack the grouping's field before the
// page suggests a re-seed.
const DATA_GAP_SHARE = 0.9;

function hasField(row: CharRow, key: GroupKey): boolean {
	switch (key) {
		case 'grade':
			return row.g !== undefined;
		case 'freq':
			return row.f !== undefined;
		case 'strokes':
			return row.s !== undefined;
		case 'common':
			return row.t !== undefined || row.b !== undefined;
		case 'hkgrade':
			return row.h !== undefined;
		default:
			return true;
	}
}

/**
 * dataGap is true when at least 90 % of the characters lack the field the
 * grouping sorts by: the data predates the importer that keeps it, and a
 * re-seed would fill it. Scheme groupings and empty lists never gap.
 */
export function dataGap(chars: readonly CharRow[], key: GroupKey): boolean {
	if (chars.length === 0 || key.startsWith('scheme:')) return false;
	let missing = 0;
	for (const row of chars) if (!hasField(row, key)) missing += 1;
	return missing >= DATA_GAP_SHARE * chars.length;
}
