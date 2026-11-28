// The mastery map page's pure helpers: which sections start open, how the
// arrow keys move inside a section, the summary wording, the remembered
// "Group by" choice and finding a character to jump to. charGroups.ts owns
// the grouping and mastery logic; this module only shapes the page.

import type { CharRow } from '$lib/api/types';
import { t, type MessageKey } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';
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

/**
 * The five stages in legend order, with their visible names. The names are
 * deliberately not the word states' (New/Learning/Young/Mature, see
 * lib/stats/wordStates.ts): a word's schedule state and a character's mastery
 * band are different things. The stage ids stay as they are in code.
 */
function stage(id: Stage, label: MessageKey): { stage: Stage; readonly label: string } {
	return {
		stage: id,
		get label() {
			return t(label);
		}
	};
}

export const STAGE_INFO: readonly { stage: Stage; readonly label: string }[] = [
	stage('unknown', 'stats.map.stage.unknown'),
	stage('fresh', 'stats.map.stage.fresh'),
	stage('learning', 'stats.map.stage.learning'),
	stage('mature', 'stats.map.stage.mature'),
	stage('learned', 'stats.map.stage.learned')
];

/**
 * defaultOpenSections is the open state a grouping starts with: every
 * non-empty section, so a learner sees literally every character. The
 * batched renderer (see renderedCount) keeps that cheap: each section
 * paints a first batch and the biggest ones stream in.
 */
export function defaultOpenSections(sections: readonly { id: string; size: number }[]): Set<string> {
	return new Set(sections.filter((section) => section.size > 0).map((section) => section.id));
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

export function formatCount(value: number): string {
	return formatNumber(value);
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
	return t('stats.map.learnedSummary', { learned: formatCount(learned), total: formatCount(total), percent });
}

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
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
	if (!filtering) return t('stats.map.showingAll', { total: formatCount(total) });
	if (shown === 0) return t('stats.map.noMatch');
	return t('stats.map.filtered', { count: shown, shown: formatCount(shown), total: formatCount(total) });
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
		return { sections: [{ id: 'all', label: t('stats.map.allCharacters'), chars: [...chars] }], gap: true };
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
 * many are rendered now: a first batch, then one more batch per step, so
 * expanding 3k or 10k cells paints at once and fills in. A far keyboard or
 * jump target does not skip the batching; the caller focuses it once it
 * exists.
 */
export function renderedCount(total: number, rendered: number): number {
	const step = rendered < FIRST_BATCH ? FIRST_BATCH : rendered + RENDER_BATCH;
	return Math.min(total, step);
}

/**
 * nextBatchOwner picks which waiting section renders its next batch in
 * this frame: one waiting for a focus target first, else the one highest
 * on the page, so the sections fill top-down one batch per frame. -1 when
 * none waits.
 */
export function nextBatchOwner(waiting: readonly { order: number; urgent?: boolean }[]): number {
	let best = -1;
	for (let index = 0; index < waiting.length; index += 1) {
		const item = waiting[index];
		if (best === -1) {
			best = index;
			continue;
		}
		const current = waiting[best];
		const urgentWins = (item.urgent ?? false) && !(current.urgent ?? false);
		const sameUrgency = (item.urgent ?? false) === (current.urgent ?? false);
		if (urgentWins || (sameUrgency && item.order < current.order)) best = index;
	}
	return best;
}

