// The mastery map page's pure helpers: which sections start open, how the
// arrow keys move inside a section, the summary wording, the remembered
// "Group by" choice and finding a character to jump to. charGroups.ts owns
// the grouping and mastery logic; this module only shapes the page.

import type { CharRow } from '$lib/api/types';
import {
	buildSections,
	dataGap,
	type CellState,
	type GroupKey,
	type GroupOption,
	type Section,
	type SchemeLevelMembers,
	type Stage
} from './charGroups';

/** Up to this many characters, every section starts expanded. */
export const EXPAND_ALL_LIMIT = 1500;

/** The five stages in legend order, with their visible names. */
export const STAGE_INFO: readonly { stage: Stage; label: string }[] = [
	{ stage: 'unknown', label: 'Not studied' },
	{ stage: 'fresh', label: 'Fresh' },
	{ stage: 'learning', label: 'Learning' },
	{ stage: 'mature', label: 'Mature' },
	{ stage: 'learned', label: 'Learned' }
];

/**
 * defaultOpenSections is the open state a grouping starts with: every
 * non-empty section when the characters shown total at most 1500,
 * otherwise only the first non-empty one (the rest wait for "Expand all"
 * or a click, so 13k cells never render at once).
 */
export function defaultOpenSections(sections: readonly { id: string; size: number }[]): Set<string> {
	const nonEmpty = sections.filter((section) => section.size > 0);
	const total = nonEmpty.reduce((sum, section) => sum + section.size, 0);
	if (total <= EXPAND_ALL_LIMIT) return new Set(nonEmpty.map((section) => section.id));
	return new Set(nonEmpty.slice(0, 1).map((section) => section.id));
}

/**
 * gridMove is the roving-tabindex step inside one section laid out in
 * `columns` columns: arrows move by one cell or one row (down to a
 * shorter last row lands on the last cell), Home/End go to the row's
 * ends and, with Ctrl, to the section's. Null for keys it does not own.
 */
export function gridMove(
	index: number,
	key: string,
	count: number,
	columns: number,
	ctrl = false
): number | null {
	if (count <= 0) return null;
	const cols = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 1;
	const at = Math.min(Math.max(0, index), count - 1);
	const last = count - 1;
	const rowStart = at - (at % cols);
	switch (key) {
		case 'ArrowRight':
			return Math.min(at + 1, last);
		case 'ArrowLeft':
			return Math.max(at - 1, 0);
		case 'ArrowDown': {
			if (at + cols <= last) return at + cols;
			// A shorter last row below: land on its last cell.
			return rowStart + cols <= last ? last : at;
		}
		case 'ArrowUp':
			return at - cols >= 0 ? at - cols : at;
		case 'Home':
			return ctrl ? 0 : rowStart;
		case 'End':
			return ctrl ? last : Math.min(rowStart + cols - 1, last);
		default:
			return null;
	}
}

/** columnCount counts the tracks of a computed `grid-template-columns`. */
export function columnCount(template: string): number {
	const value = template.trim();
	if (value === '' || value === 'none') return 1;
	return Math.max(1, value.split(/\s+/).length);
}

const NUMBER = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
	return NUMBER.format(value);
}

/**
 * learnedSummary is the header line "N of M learned (p %)". A share that
 * is not zero never shows as 0 %, and an incomplete one never as 100 %.
 */
export function learnedSummary(learned: number, total: number): string {
	let percent = '0';
	if (total > 0 && learned > 0) {
		const exact = (100 * learned) / total;
		const rounded = Math.round(exact);
		if (rounded === 0) percent = '<1';
		else if (rounded === 100 && learned < total) percent = '>99';
		else percent = String(rounded);
	}
	return `${formatCount(learned)} of ${formatCount(total)} learned (${percent} %)`;
}

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

function groupByKey(language: string): string {
	return `qinqin.map.groupBy.${primarySubtag(language)}`;
}

/**
 * readGroupBy returns the grouping remembered for a language when it is
 * still offered, else the first option (null when there is none).
 * Storage that is missing or throws counts as empty.
 */
export function readGroupBy(
	storage: Storage | null,
	language: string,
	options: readonly GroupOption[]
): GroupKey | null {
	if (options.length === 0) return null;
	let stored: string | null = null;
	try {
		stored = storage?.getItem(groupByKey(language)) ?? null;
	} catch {
		stored = null;
	}
	const match = options.find((option) => option.key === stored);
	return (match ?? options[0]).key;
}

/** writeGroupBy remembers the grouping for a language; failures are ignored. */
export function writeGroupBy(storage: Storage | null, language: string, key: GroupKey): void {
	try {
		storage?.setItem(groupByKey(language), key);
	} catch {
		// Private mode or denied storage: the choice lasts for this visit.
	}
}

/** jumpGlyph is the character a "Jump to" input asks for: its first code point. */
export function jumpGlyph(input: string): string | null {
	const first = Array.from(input.trim())[0];
	return first === undefined ? null : first;
}

/**
 * locateGlyph finds the cell showing `glyph`: the cell of that glyph
 * first, else the first cell listing it as a variant (愛 finds 爱).
 */
export function locateGlyph(
	sections: readonly { id: string; cells: readonly CellState[] }[],
	glyph: string
): { sectionId: string; index: number } | null {
	for (const section of sections) {
		const index = section.cells.findIndex((cell) => cell.char.c === glyph);
		if (index >= 0) return { sectionId: section.id, index };
	}
	for (const section of sections) {
		const index = section.cells.findIndex((cell) => cell.char.v?.includes(glyph) ?? false);
		if (index >= 0) return { sectionId: section.id, index };
	}
	return null;
}

/** filterAnnouncement is the live-region text after a filter changes. */
export function filterAnnouncement(shown: number, total: number, filtering: boolean): string {
	if (!filtering) return `Showing all ${formatCount(total)} characters.`;
	if (shown === 0) return 'No characters match.';
	return `${formatCount(shown)} of ${formatCount(total)} characters ${shown === 1 ? 'matches' : 'match'}.`;
}

/** stageSegments are the non-empty parts of a stacked stage bar, in percent. */
export function stageSegments(
	byStage: Record<Stage, number>
): { stage: Stage; count: number; share: number }[] {
	const total = STAGE_INFO.reduce((sum, { stage }) => sum + byStage[stage], 0);
	if (total === 0) return [];
	return STAGE_INFO.filter(({ stage }) => byStage[stage] > 0).map(({ stage }) => ({
		stage,
		count: byStage[stage],
		share: (100 * byStage[stage]) / total
	}));
}

/**
 * sectionsFor builds the grouping's sections, or one "All characters"
 * section when at least 90 % of the characters lack its field (an old
 * database): the grid still shows everything while the page asks for a
 * re-seed.
 */
export function sectionsFor(
	chars: readonly CharRow[],
	key: GroupKey,
	members?: readonly SchemeLevelMembers[]
): { sections: Section[]; gap: boolean } {
	if (chars.length === 0) return { sections: [], gap: false };
	if (dataGap(chars, key)) {
		return { sections: [{ id: 'all', label: 'All characters', chars: [...chars] }], gap: true };
	}
	return { sections: buildSections(chars, key, members), gap: false };
}

/** TipRequest asks the page to show a cell's popover. */
export interface TipRequest {
	cell: CellState;
	el: HTMLElement;
	/** How it was asked for: a keyboard focus, a mouse hover, or a tap. */
	via: 'focus' | 'hover' | 'tap';
}

/** Cells rendered in the first frame of an expanded section (more than a screenful). */
export const FIRST_BATCH = 400;
/** Cells added per following frame until the section is complete. */
export const RENDER_BATCH = 1200;

/**
 * renderedCount is how many cells of a section to render next, given how
 * many are rendered now: a first batch, then one more batch per frame, so
 * expanding 3k or 10k cells paints at once and fills in. The active cell
 * (keyboard or jump target) is always included so it can take focus.
 */
export function renderedCount(total: number, rendered: number, active: number): number {
	const step = rendered < FIRST_BATCH ? FIRST_BATCH : rendered + RENDER_BATCH;
	return Math.min(total, Math.max(step, active + 1));
}
