// The daily goal row `goals:workspace` (a keyed row,
// workspace-scoped): parse, the goal in effect on a learner day, and the
// row an edit writes. Pure. Rule and fixtures: docs/contracts/goals/.

import { addDays, isDay } from '../time/studyDay';

export const GOALS_KEY = 'goals:workspace';
export const MAX_GOAL_ENTRIES = 400;
export const MAX_COUNT_TARGET = 9999;
export const MAX_MINUTES_TARGET = 1440;
const MAX_TYPE_LENGTH = 64;
const ACTIVITY_PREFIX = 'activity:';

export type GoalMetric = `activity:${string}` | 'flashcards:new' | 'flashcards:studyTime';

export interface GoalEntry {
	from: string;
	metric: GoalMetric | null;
	target: number | null;
	[key: string]: unknown;
}

export interface GoalsRow {
	version: 1;
	showStreak: boolean;
	history: GoalEntry[];
	[key: string]: unknown;
}

/** A row, a row of a newer client ('newer': never overwritten), or none. */
export type ParsedGoals = GoalsRow | 'newer' | null;

export interface Goal {
	metric: GoalMetric;
	target: number;
}

export type GoalEdit = Goal | null | { showStreak: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isGoalMetric(value: unknown): value is GoalMetric {
	if (value === 'flashcards:new' || value === 'flashcards:studyTime') return true;
	if (typeof value !== 'string' || !value.startsWith(ACTIVITY_PREFIX)) return false;
	const type = value.slice(ACTIVITY_PREFIX.length);
	return type.length > 0 && type.length <= MAX_TYPE_LENGTH;
}

/** activityType: the type of an `activity:<type>` metric, else null. */
export function activityType(metric: GoalMetric): string | null {
	return metric.startsWith(ACTIVITY_PREFIX) ? metric.slice(ACTIVITY_PREFIX.length) : null;
}

/** targetRange: the allowed target in display units; `unit` is the activity source's unit (null: unknown). */
export function targetRange(
	metric: GoalMetric,
	unit: 'count' | 'seconds' | null
): { min: 1; max: number; unit: 'count' | 'minutes' } {
	const minutes = metric === 'flashcards:studyTime' || (activityType(metric) !== null && unit === 'seconds');
	return minutes ? { min: 1, max: MAX_MINUTES_TARGET, unit: 'minutes' } : { min: 1, max: MAX_COUNT_TARGET, unit: 'count' };
}

function validTarget(metric: GoalMetric, target: unknown): target is number {
	// The source's unit is unknown when parsing, so an activity target may be
	// up to the count maximum; Settings offers the unit's own range.
	const max = metric === 'flashcards:studyTime' ? MAX_MINUTES_TARGET : MAX_COUNT_TARGET;
	return typeof target === 'number' && Number.isInteger(target) && target >= 1 && target <= max;
}

function parseEntry(raw: unknown): GoalEntry | null {
	if (!isRecord(raw) || !isDay(raw.from)) return null;
	if (raw.metric === null) return raw.target === null ? (raw as GoalEntry) : null;
	if (!isGoalMetric(raw.metric) || !validTarget(raw.metric, raw.target)) return null;
	return raw as GoalEntry;
}

/** sortEntries: by `from`; of equal `from` the later position wins. */
function sortEntries(entries: readonly GoalEntry[]): GoalEntry[] {
	const byFrom = new Map<string, GoalEntry>();
	for (const entry of entries) byFrom.set(entry.from, entry);
	return [...byFrom.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

// Entries a row holds that this client does not understand (another
// client's metric, a bad date): left out of the parsed history, so goalOn
// never sees them, and written back verbatim after the understood ones.
const foreignEntries = new WeakMap<GoalsRow, readonly unknown[]>();

export function parseGoalsRow(raw: unknown): ParsedGoals {
	if (!isRecord(raw)) return null;
	const { version } = raw;
	if (typeof version !== 'number' || !Number.isInteger(version)) return null;
	if (version > 1) return 'newer';
	if (version !== 1) return null;
	const entries: GoalEntry[] = [];
	const foreign: unknown[] = [];
	for (const value of Array.isArray(raw.history) ? raw.history : []) {
		const entry = parseEntry(value);
		if (entry === null) foreign.push(value);
		else entries.push({ ...entry });
	}
	const row: GoalsRow = {
		...raw,
		version: 1,
		showStreak: typeof raw.showStreak === 'boolean' ? raw.showStreak : true,
		history: sortEntries(entries)
	};
	if (foreign.length > 0) foreignEntries.set(row, foreign);
	return row;
}

/** withForeign is the row to write: the understood history plus the entries kept verbatim. */
function withForeign(source: GoalsRow | null, next: GoalsRow): GoalsRow {
	const foreign = source === null ? undefined : foreignEntries.get(source);
	if (foreign === undefined) return next;
	return { ...next, history: [...next.history, ...(foreign as GoalEntry[])] };
}

function entryOn(row: GoalsRow | null, day: string): GoalEntry | null {
	if (row === null) return null;
	let found: GoalEntry | null = null;
	for (const entry of row.history) {
		if (entry.from <= day) found = entry;
		else break;
	}
	return found;
}

/** goalOn: the goal in effect on `day`, null for none. */
export function goalOn(row: GoalsRow | null, day: string): Goal | null {
	const entry = entryOn(row, day);
	if (entry === null || entry.metric === null || entry.target === null) return null;
	return { metric: entry.metric, target: entry.target };
}

/** metricsBetween: the metrics of every goal in effect on some day of from..to. */
export function metricsBetween(row: GoalsRow | null, from: string, to: string): GoalMetric[] {
	if (row === null) return [];
	const first = entryOn(row, from);
	const entries = [
		...(first === null ? [] : [first]),
		...row.history.filter((e) => e.from > from && e.from <= to)
	];
	return [...new Set(entries.flatMap((e) => (e.metric === null ? [] : [e.metric])))];
}

function sameGoal(a: Goal | null, b: Goal | null): boolean {
	if (a === null || b === null) return a === b;
	return a.metric === b.metric && a.target === b.target;
}

/** The row to write, or null when nothing changes. Throws on a 'newer' row. */
export function planGoalEdit(row: ParsedGoals, edit: GoalEdit, today: string): GoalsRow | null {
	if (row === 'newer') throw new Error('the goal row was written by a newer version of qinqin');
	if (!isDay(today)) throw new RangeError(`not a day: ${today}`);
	if (edit !== null && 'showStreak' in edit) {
		const current = row?.showStreak ?? true;
		if (edit.showStreak === current) return null;
		return row === null
			? { version: 1, showStreak: edit.showStreak, history: [] }
			: withForeign(row, { ...row, showStreak: edit.showStreak });
	}
	if (edit !== null && (!isGoalMetric(edit.metric) || !validTarget(edit.metric, edit.target))) {
		throw new RangeError('invalid goal');
	}
	const goal: Goal | null = edit === null ? null : { metric: edit.metric, target: edit.target };
	if (sameGoal(goalOn(row, today), goal)) return null;

	const base: GoalsRow = row ?? { version: 1, showStreak: true, history: [] };
	const history = [...base.history];
	const index = history.findIndex((entry) => entry.from === today);
	const values = { from: today, metric: goal?.metric ?? null, target: goal?.target ?? null };
	if (index >= 0) {
		const before = goalOn({ ...base, history: history.filter((e) => e.from < today) }, addDays(today, -1));
		if (sameGoal(before, goal)) history.splice(index, 1);
		else history[index] = { ...history[index], ...values };
	} else {
		history.push(values);
	}
	const sorted = sortEntries(history);
	return withForeign(row, { ...base, history: sorted.slice(Math.max(0, sorted.length - MAX_GOAL_ENTRIES)) });
}
