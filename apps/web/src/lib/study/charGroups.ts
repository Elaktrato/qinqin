// The character grid's pure logic: which "Group by" options a language
// offers, how the universe list splits into sections, and how the derived
// per-glyph mastery becomes one state per cell. A cell shares its score
// with its variant forms (a card written 愛 lights 爱), taking the maximum.

import type { CharRow, Scheme } from '$lib/api/types';
import { stageOf, type CharMastery, type MasteryStage } from './mastery';

export type Stage = MasteryStage;

/** The `learned` band: a cell at or above this score counts as learned. */
export const MASTERY_THRESHOLD = 80;

export type GroupKey =
	| 'grade'
	| 'jlpt'
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
	{ key: 'jlpt', label: 'JLPT (old scale)' },
	{ key: 'freq', label: 'Frequency' },
	{ key: 'strokes', label: 'Strokes' }
];

const ZH_OPTIONS: GroupOption[] = [
	{ key: 'common', label: 'Common' },
	{ key: 'hkgrade', label: 'HK primary grade' },
	{ key: 'strokes', label: 'Strokes' }
];

// The bundled level packs are hand-written samples, not real lists.
const SAMPLE_PACK_IDS = new Set(['hsk-mini', 'jlpt-mini']);

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * isSampleScheme recognises the bundled samples by pack id, and by name
 * as a fallback (`hsk-mini`, "HSK mini (sample)", "JLPT N5 mini (sample)").
 */
function isSampleScheme(scheme: Scheme): boolean {
	if (scheme.packId !== undefined && SAMPLE_PACK_IDS.has(scheme.packId)) return true;
	const slug = scheme.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return /^(hsk|jlpt)(-n\d)?-mini(-sample)?$/.test(slug);
}

/**
 * groupOptions lists the "Group by" choices for a workspace language:
 * the built-in groupings of ja or zh, then one option per installed level
 * scheme of that language (the bundled samples are hidden). Languages not
 * written with Han characters have none.
 */
export function groupOptions(language: string, schemes: readonly Scheme[]): GroupOption[] {
	const lang = primarySubtag(language);
	const builtIn = lang === 'ja' ? JA_OPTIONS : lang === 'zh' ? ZH_OPTIONS : null;
	if (builtIn === null) return [];
	const fromSchemes = schemes
		.filter((scheme) => primarySubtag(scheme.language) === lang && !isSampleScheme(scheme))
		.map((scheme): GroupOption => ({ key: `scheme:${scheme.id}`, label: scheme.name }));
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

const GRADE_NAMES: Slot = { id: 'grade-names', label: 'Names (jinmeiyō, grades 9–10)', rank: 9 };
const GRADE_NONE: Slot = { id: 'grade-none', label: 'Not graded', rank: 99 };

function gradeSlot(row: CharRow): Slot {
	const g = row.g;
	if (isPositiveInt(g) && g <= 6) return { id: `grade-${g}`, label: `Grade ${g}`, rank: g };
	if (g === 8) return { id: 'grade-8', label: 'Secondary school (grade 8)', rank: 8 };
	if (g === 9 || g === 10) return GRADE_NAMES;
	return GRADE_NONE;
}

function jlptSlot(row: CharRow): Slot {
	const j = row.j;
	// Old scale: 4 is the easiest level and comes first.
	if (isPositiveInt(j) && j <= 4) {
		return { id: `jlpt-${j}`, label: `JLPT ${j} (pre-2010 scale)`, rank: 5 - j };
	}
	return { id: 'jlpt-none', label: 'Not in JLPT', rank: 99 };
}

const FREQ_BUCKET = 500;

function freqSlot(row: CharRow): Slot {
	const f = row.f;
	if (!isPositiveInt(f)) return { id: 'freq-none', label: 'Not ranked', rank: Number.MAX_SAFE_INTEGER };
	// A rank past the last regular bucket keeps its own correctly labelled
	// 500-wide bucket rather than being mislabelled or dropped.
	const bucket = Math.ceil(f / FREQ_BUCKET);
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

function schemeSlotter(members: ReadonlyMap<string, ReadonlySet<string>> | undefined): (row: CharRow) => Slot {
	const levels = [...(members?.entries() ?? [])].map(([name, set], index) => ({
		slot: { id: `level-${index}`, label: name, rank: index } satisfies Slot,
		set
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
	members: ReadonlyMap<string, ReadonlySet<string>> | undefined
): (row: CharRow) => Slot {
	switch (key) {
		case 'grade':
			return gradeSlot;
		case 'jlpt':
			return jlptSlot;
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
 * grouping, `schemeMembers` maps level names (in level order) to their
 * member glyphs.
 */
export function buildSections(
	chars: readonly CharRow[],
	key: GroupKey,
	schemeMembers?: ReadonlyMap<string, ReadonlySet<string>>
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

function fold(text: string): string {
	return text.normalize('NFKC').toLowerCase();
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
 * gloss contains the query. Matching is case-insensitive on NFKC forms;
 * a blank query matches everything.
 */
export function filterCells(
	cells: readonly CellState[],
	filter: StageFilter,
	query: string
): CellState[] {
	const needle = fold(query.trim());
	return cells.filter((cell) => {
		if (!matchesStage(cell, filter)) return false;
		if (needle === '') return true;
		const { c, v, r, m } = cell.char;
		const fields = [c, ...(v ?? []), r ?? '', m ?? ''];
		return fields.some((field) => fold(field).includes(needle));
	});
}

// The share of characters that must lack the grouping's field before the
// page suggests a re-seed.
const DATA_GAP_SHARE = 0.9;

function hasField(row: CharRow, key: GroupKey): boolean {
	switch (key) {
		case 'grade':
			return row.g !== undefined;
		case 'jlpt':
			return row.j !== undefined;
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
