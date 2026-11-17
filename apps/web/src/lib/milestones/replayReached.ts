// Milestones that need the schedule replay: mature words, characters learned
// and complete levels. One sweep over the timeline points of the workspace's
// cards in instant order; all points at one instant are applied together,
// then the thresholds are checked, so the running values equal a snapshot
// (scheduleAt) at every instant. Counters are incremental: a point updates
// only its card, the running strength sums of the glyphs of its written form
// and the cells and levels that hold them. Pure and memoised per timelines object.
// Rule and fixtures: docs/contracts/milestones/ (reached.json).

import type { CharRow } from '$lib/api/types';
import { classifySchedule } from '$lib/stats/wordStates';
import { MASTERY_KINDS, MASTERY_THRESHOLD, cardStrength, masteryFromSchedules } from '$lib/study/mastery';
import type { Schedule } from '$lib/study/scheduler';
import type { StudyCard } from '$lib/study/types';
import type { StudyDay } from '$lib/time/studyDay';
import type { Timelines } from '$lib/weekly/replay';
import { FAMILIES, compareIds, levelMilestoneId, type MilestoneFamily } from './catalogue';
import { cardsKey, type Reached } from './reached';

export interface LevelInput {
	packId: string;
	level: string;
	unit: 'word' | 'character';
	/** Word levels: the member entries (levelItems). */
	entryIds: readonly number[];
	/** Character levels: each cell of the level's section as its glyph forms (variants included). */
	cells?: readonly string[][];
}

export interface ReplayInputs {
	cards: readonly StudyCard[];
	deckIds: ReadonlySet<string>;
	timelines: Timelines;
	day: StudyDay;
	now: number;
	families: ReadonlySet<MilestoneFamily>;
	/** The language's character universe; null = no characters family. */
	chars: readonly CharRow[] | null;
	levels: readonly LevelInput[];
}

/** The running values after one instant (tests compare them with snapshots). */
export interface SweepState {
	mature: number;
	learned: number;
	/** Per level: members mature (word) or cells learned (character). */
	levels: number[];
}

interface Cell {
	forms: readonly string[];
	learned: boolean;
	/** The universe counts it; levels holding it, by index. */
	universe: boolean;
	levels: number[];
}

/**
 * sweep replays the points with ts ≤ now and calls `probe` after each
 * instant with the running values. reachedFromReplay reads the crossings.
 */
export function sweep(
	input: ReplayInputs,
	probe: (t: number, state: SweepState) => void
): void {
	const { families, timelines, now } = input;
	const wantMature = families.has('words-mature');
	const wantLevels = families.has('level-complete');
	const wantChars = families.has('characters-learned') && input.chars !== null;
	const levels = wantLevels ? input.levels : [];

	// Cells: the universe's, then each character level's own.
	const cells: Cell[] = [];
	const cellsOf = new Map<string, number[]>();
	const addCell = (forms: readonly string[], universe: boolean, level: number | null): void => {
		const index = cells.length;
		cells.push({ forms, learned: false, universe, levels: level === null ? [] : [level] });
		for (const glyph of new Set(forms)) {
			if (glyph === '') continue;
			const list = cellsOf.get(glyph);
			if (list === undefined) cellsOf.set(glyph, [index]);
			else list.push(index);
		}
	};
	if (wantChars) for (const row of input.chars ?? []) addCell([row.c, ...(row.v ?? [])], true, null);
	levels.forEach((level, i) => {
		if (level.unit === 'character') for (const forms of level.cells ?? []) addCell(forms, false, i);
	});

	// Word levels: per member entry, the levels holding it.
	const levelsOfEntry = new Map<number, number[]>();
	levels.forEach((level, i) => {
		if (level.unit === 'character') return;
		for (const entry of new Set(level.entryIds)) {
			const list = levelsOfEntry.get(entry);
			if (list === undefined) levelsOfEntry.set(entry, [i]);
			else list.push(i);
		}
	});

	// The cards that matter and what each point of theirs updates.
	const isScoped = (card: StudyCard): boolean =>
		card.kind === 'vocab' && card.deckIds.some((id) => input.deckIds.has(id));
	const trackMature = wantMature || levelsOfEntry.size > 0;
	const cardsOfGlyph = new Map<string, StudyCard[]>();
	const glyphsOfCard = new Map<string, string[]>();
	if (cellsOf.size > 0) {
		for (const card of input.cards) {
			if (!MASTERY_KINDS.includes(card.kind) || card.written === undefined || card.written === '') continue;
			const glyphs = [...new Set(Array.from(card.written))].filter((g) => cellsOf.has(g));
			if (glyphs.length === 0) continue;
			glyphsOfCard.set(card.id, glyphs);
			for (const glyph of glyphs) {
				const list = cardsOfGlyph.get(glyph);
				if (list === undefined) cardsOfGlyph.set(glyph, [card]);
				else list.push(card);
			}
		}
	}

	interface Tracked {
		card: StudyCard;
		scoped: boolean;
		glyphs: string[];
	}
	const tracked: Tracked[] = [];
	const seen = new Set<string>();
	for (const card of input.cards) {
		if (seen.has(card.id)) continue;
		const scoped = trackMature && isScoped(card);
		const glyphs = glyphsOfCard.get(card.id) ?? [];
		if (!scoped && glyphs.length === 0) continue;
		seen.add(card.id);
		tracked.push({ card, scoped, glyphs });
	}

	const points: { ts: number; card: number; schedule: Schedule }[] = [];
	tracked.forEach((t, card) => {
		for (const point of timelines.of(t.card.id)) {
			if (point.ts <= now) points.push({ ts: point.ts, card, schedule: point.schedule });
		}
	});
	// Stable: a card's own points keep their replay order within one instant.
	points.sort((a, b) => a.ts - b.ts);

	const current = new Map<string, Schedule>();
	const matureNow: boolean[] = tracked.map(() => false);
	const matureCards = new Map<number, number>(); // entry -> mature scoped cards
	const levelCount = levels.map(() => 0);
	const score = new Map<string, number>();
	const sums = new Map<string, number>();
	const counts = new Map<string, number>();
	let mature = 0;
	let learned = 0;

	const scheduleOf = (id: string): Schedule | null => current.get(id) ?? null;

	let i = 0;
	while (i < points.length) {
		const t = points[i].ts;
		const dirty = new Set<string>();
		for (; i < points.length && points[i].ts === t; i++) {
			const p = points[i];
			const entry = tracked[p.card];
			const previous = current.get(entry.card.id);
			current.set(entry.card.id, p.schedule);
			if (entry.glyphs.length > 0) {
				const delta = cardStrength(p.schedule.stability) - (previous === undefined ? 0 : cardStrength(previous.stability));
				for (const glyph of entry.glyphs) {
					sums.set(glyph, (sums.get(glyph) ?? 0) + delta);
					if (previous === undefined) counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
					dirty.add(glyph);
				}
			}
			if (!entry.scoped) continue;
			const isMature = classifySchedule(p.schedule) === 'mature';
			if (isMature === matureNow[p.card]) continue;
			matureNow[p.card] = isMature;
			mature += isMature ? 1 : -1;
			const id = entry.card.entryId;
			const before = matureCards.get(id) ?? 0;
			const after = before + (isMature ? 1 : -1);
			matureCards.set(id, after);
			if ((before === 0) !== (after === 0)) {
				for (const level of levelsOfEntry.get(id) ?? []) levelCount[level] += after > 0 ? 1 : -1;
			}
		}
		// Glyph scores from running sums; a mean that sits on a rounding edge is
		// computed again exactly as the map does (masteryFromSchedules, card order).
		const touched = new Set<number>();
		for (const glyph of dirty) {
			const n = counts.get(glyph) ?? 0;
			const x = n === 0 ? 0 : (100 * (sums.get(glyph) ?? 0)) / n;
			let value = Math.round(x);
			if (Math.abs(x - Math.floor(x) - 0.5) < 1e-6) {
				value = masteryFromSchedules([glyph], cardsOfGlyph.get(glyph) ?? [], scheduleOf).get(glyph)?.score ?? 0;
			}
			score.set(glyph, value);
			for (const cell of cellsOf.get(glyph) ?? []) touched.add(cell);
		}
		for (const index of touched) {
			const cell = cells[index];
			const isLearned = cell.forms.some((g) => (score.get(g) ?? 0) >= MASTERY_THRESHOLD);
			if (isLearned === cell.learned) continue;
			cell.learned = isLearned;
			const delta = isLearned ? 1 : -1;
			if (cell.universe) learned += delta;
			for (const level of cell.levels) levelCount[level] += delta;
		}
		probe(t, { mature, learned, levels: levelCount.slice() });
	}
}

function compute(input: ReplayInputs): Reached[] {
	const out: Reached[] = [];
	const thresholds = (family: MilestoneFamily) =>
		input.families.has(family) ? (FAMILIES.find((f) => f.family === family)?.thresholds ?? []) : [];
	const matureAt = thresholds('words-mature');
	const learnedAt = input.chars === null ? [] : thresholds('characters-learned');
	const levels = input.families.has('level-complete') ? input.levels : [];
	const levelSizes = levels.map((level) =>
		level.unit === 'character' ? (level.cells ?? []).length : new Set(level.entryIds).size
	);
	const done = levels.map(() => false);
	let nextMature = 0;
	let nextLearned = 0;
	const probe = (t: number, state: SweepState): void => {
		const day = input.day.dayOf(t);
		while (nextMature < matureAt.length && state.mature >= matureAt[nextMature]) {
			out.push({ id: `words-mature:${matureAt[nextMature++]}`, at: t, day });
		}
		while (nextLearned < learnedAt.length && state.learned >= learnedAt[nextLearned]) {
			out.push({ id: `characters-learned:${learnedAt[nextLearned++]}`, at: t, day });
		}
		levels.forEach((level, i) => {
			if (done[i] || levelSizes[i] === 0 || state.levels[i] < levelSizes[i]) return;
			done[i] = true;
			out.push({ id: levelMilestoneId(level.packId, level.level), at: t, day });
		});
	};
	sweep(input, probe);
	return out.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
}

// One answer per timelines object and scope; the timelines are memoised by
// the reviews' content already (timelinesFor), so a reload sweeps nothing.
const memo = new WeakMap<Timelines, Map<string, Reached[]>>();
const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identity(value: object | null): number {
	if (value === null) return 0;
	let id = identities.get(value);
	if (id === undefined) {
		id = nextIdentity++;
		identities.set(value, id);
	}
	return id;
}

/**
 * reachedFromReplay: the reached words-mature, characters-learned and
 * level-complete milestones, ordered by instant then catalogue order.
 */
export function reachedFromReplay(input: ReplayInputs): Reached[] {
	const key = [
		cardsKey(input.cards, input.deckIds),
		identity(input.day),
		input.day.today(input.now),
		[...input.families].sort().join(','),
		identity(input.chars),
		JSON.stringify(input.levels)
	].join('|');
	let byKey = memo.get(input.timelines);
	if (byKey === undefined) {
		byKey = new Map();
		memo.set(input.timelines, byKey);
	}
	const cached = byKey.get(key);
	if (cached !== undefined) return cached;
	const result = compute(input);
	if (byKey.size >= 4) byKey.delete(byKey.keys().next().value as string);
	byKey.set(key, result);
	return result;
}
