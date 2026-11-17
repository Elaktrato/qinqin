// Core activity: one points-per-day view across every learning source.
// The server scores events by the activity rules in plugin manifests
// (GET /api/stats/activity) and returns cells per learner day, workspace
// and type (lib/time/studyDay.ts); these pure functions fold them into
// the heatmap's days.

import type { ActivityResponse, ActivitySource } from '../api/stats';
import { t } from '../i18n';
import { addDays, type StudyDay } from '../time/studyDay';
import { isVacationDay, vacationRuns, type VacationPeriod } from '../study/vacation';

/** Days covered by the heatmap: 13 weeks of 7 cells. */
export const HEATMAP_DAYS = 91;

/** The scope and filter a heatmap is drawn for. */
export interface ActivityView {
	/** One workspace, or null for all workspaces combined. */
	workspace: number | null;
	/** Activity types left out of totals, cells and tooltips. */
	hidden: readonly string[];
}

export interface DayActivity {
	day: string;
	total: number;
	bySource: Record<string, number>;
	/** Per-type raw amount: summed clamped seconds for read, event count for review. */
	raw: Record<string, number>;
	/** Points per workspace; filled only for the combined view. */
	byWorkspace: Record<number, number>;
	/** 'all': every workspace of the view is on vacation; 'some': only `vacationIn`. */
	vacation: 'all' | 'some' | null;
	vacationIn: number[];
}

/** A vacation mark of one day: who is away. */
export interface VacationMark {
	mode: 'all' | 'some';
	workspaces: number[];
}

/**
 * vacationMarks says, per learner day of the window, which workspaces of the
 * view are on vacation. A single-workspace view marks its own days 'all'; the
 * combined view marks 'all' when every workspace is away and 'some' otherwise.
 */
export function vacationMarks(
	periods: readonly VacationPeriod[],
	workspaceIds: readonly number[],
	workspace: number | null,
	day: StudyDay,
	now: Date = new Date(),
	days: number = HEATMAP_DAYS
): Map<string, VacationMark> {
	const marks = new Map<string, VacationMark>();
	const today = day.today(now.getTime());
	const start = windowStart(day, now, days);
	const scope = workspace === null ? [...workspaceIds] : [workspace];
	if (scope.length === 0 || periods.length === 0) return marks;
	const runs = new Map(scope.map((id) => [id, vacationRuns(periods, id, today)]));
	for (let key = start; key <= today; key = addDays(key, 1)) {
		const away = scope.filter((id) => isVacationDay(runs.get(id) ?? [], key));
		if (away.length === 0) continue;
		marks.set(key, { mode: away.length === scope.length ? 'all' : 'some', workspaces: away });
	}
	return marks;
}

function windowLength(days: number): number {
	return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : HEATMAP_DAYS;
}

/**
 * windowStart is the first learner day `foldActivity` covers, so the
 * request can ask for exactly the window. An empty window starts today.
 */
export function windowStart(
	day: StudyDay,
	now: Date = new Date(),
	days: number = HEATMAP_DAYS
): string {
	const windowDays = Math.max(1, windowLength(days));
	return addDays(day.today(now.getTime()), -(windowDays - 1));
}

/**
 * foldActivity sums the server's cells per learner day over the `days`
 * days ending on today (`day.today(now)`), oldest first, for one view.
 * Every day appears, empty ones with total 0, counted by civil dates (a
 * 23 or 25 hour day is one day). Cells of unknown types (not in
 * `sources`), hidden types, other workspaces and days outside the window
 * are ignored. A workspace the user no longer has still counts in the
 * combined view.
 */
export function foldActivity(
	resp: ActivityResponse,
	view: ActivityView,
	day: StudyDay,
	now: Date = new Date(),
	days: number = HEATMAP_DAYS,
	marks?: ReadonlyMap<string, VacationMark>
): Map<string, DayActivity> {
	const windowDays = windowLength(days);
	const result = new Map<string, DayActivity>();
	if (windowDays === 0) return result;

	const today = day.today(now.getTime());
	const start = windowStart(day, now, windowDays);
	for (let key = start; key <= today; key = addDays(key, 1)) {
		const mark = marks?.get(key);
		result.set(key, {
			day: key,
			total: 0,
			bySource: {},
			raw: {},
			byWorkspace: {},
			vacation: mark?.mode ?? null,
			vacationIn: mark?.workspaces ?? []
		});
	}

	const known = new Set(resp.sources.map((s) => s.type));
	const hidden = new Set(view.hidden);
	for (const cell of resp.cells) {
		if (!known.has(cell.type) || hidden.has(cell.type)) continue;
		if (view.workspace !== null && cell.workspace !== view.workspace) continue;
		const entry = result.get(cell.day);
		if (!entry || !(cell.points > 0)) continue;
		entry.total += cell.points;
		entry.bySource[cell.type] = (entry.bySource[cell.type] ?? 0) + cell.points;
		entry.raw[cell.type] = (entry.raw[cell.type] ?? 0) + cell.raw;
		if (view.workspace === null) {
			entry.byWorkspace[cell.workspace] = (entry.byWorkspace[cell.workspace] ?? 0) + cell.points;
		}
	}
	return result;
}

/**
 * describe words a raw amount with the rule's own template: seconds
 * show as whole minutes, at least 1; otherwise {n} is the raw count.
 */
export function describe(source: ActivitySource, raw: number): string {
	const n = source.unit === 'seconds' ? Math.max(1, Math.round(raw / 60)) : Math.round(raw);
	const template = n === 1 ? source.describe.one : source.describe.other;
	return template.replaceAll('{n}', String(n));
}

function pointsWord(count: number): string {
	return t('stats.activity.points', { count });
}

/** sourcePoints sums the window's points per activity type. */
export function sourcePoints(map: Map<string, DayActivity>): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const entry of map.values()) {
		for (const [type, points] of Object.entries(entry.bySource)) {
			totals[type] = (totals[type] ?? 0) + points;
		}
	}
	return totals;
}

/** The tooltip's vacation suffix: " · On vacation" or " · Vacation in 中文, 日本語". */
function vacationNote(day: DayActivity, workspaceName: (id: number) => string): string {
	if (day.vacation === 'all') return t('stats.activity.vacationAll');
	if (day.vacation === 'some') return t('stats.activity.vacationIn', { workspaces: day.vacationIn.map(workspaceName).join(', ') });
	return '';
}

/**
 * dayTooltip describes a day in the sources' fixed order, e.g.
 * "2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading";
 * the combined view appends " · 中文 8, 日本語 4".
 */
export function dayTooltip(
	day: DayActivity,
	sources: readonly ActivitySource[],
	workspaceName: (id: number) => string,
	allHidden = false
): string {
	if (allHidden) return t('stats.activity.dayHidden', { day: day.day });
	const away = vacationNote(day, workspaceName);
	const withAway = (text: string) => (away === '' ? text : t('stats.activity.withNote', { text, note: away }));
	if (day.total <= 0) return withAway(t('stats.activity.dayNone', { day: day.day }));
	const parts: string[] = [];
	for (const source of sources) {
		if (!day.bySource[source.type]) continue;
		parts.push(describe(source, day.raw[source.type] ?? 0));
	}
	let text = t('stats.activity.day', { day: day.day, points: pointsWord(day.total), parts: parts.join(', ') });
	const spaces = Object.entries(day.byWorkspace)
		.map(([id, points]) => ({ id: Number(id), points }))
		.sort((a, b) => b.points - a.points || a.id - b.id);
	if (spaces.length > 0) {
		text += ` · ${spaces.map((s) => `${workspaceName(s.id)} ${s.points}`).join(', ')}`;
	}
	return withAway(text);
}

/**
 * levelFor maps a day's points to a heat level 0..4 by absolute
 * thresholds (0, 1, 2-3, 4-6, 7+): the old flashcards widget's rule,
 * moved unchanged. Levels do not scale with the window's maximum.
 */
export function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	if (count <= 3) return 2;
	if (count <= 6) return 3;
	return 4;
}

/**
 * windowSummary is the heatmap's aria-label: scope, window, total points
 * and each type's total in words, e.g. "Learning activity in this
 * workspace for the last 13 weeks: 21 points — 2 flashcard reviews, 95
 * minutes of reading", or "…: no activity yet" for an empty window.
 */
export function windowSummary(
	map: Map<string, DayActivity>,
	sources: readonly ActivitySource[],
	scope: 'workspace' | 'all'
): string {
	const weeks = Math.round(map.size / 7);
	const prefix =
		scope === 'all'
			? t('stats.activity.summaryAll', { count: weeks })
			: t('stats.activity.summaryWorkspace', { count: weeks });
	const points = sourcePoints(map);
	const raw: Record<string, number> = {};
	for (const entry of map.values()) {
		for (const [type, amount] of Object.entries(entry.raw)) raw[type] = (raw[type] ?? 0) + amount;
	}
	const parts: string[] = [];
	let total = 0;
	for (const source of sources) {
		if (!(points[source.type] > 0)) continue;
		total += points[source.type];
		parts.push(describe(source, raw[source.type] ?? 0));
	}
	if (total === 0) return t('stats.activity.summaryNone', { prefix });
	return t('stats.activity.summary', { prefix, points: pointsWord(total), parts: parts.join(', ') });
}
