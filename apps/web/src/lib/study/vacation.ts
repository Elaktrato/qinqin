// Vacation periods: keyed rows -> runs of dates, and the edits the UI may
// make. Pure. Rule and fixtures: docs/contracts/scheduler/.

import { addDays, daysBetweenDates, isDay } from '../time/studyDay';

export const VACATION_PREFIX = 'vacation:';
const MAX_DATES = 366;

export type VacationScope = 'all' | { workspaces: number[] };

export interface VacationPeriod {
	version: 1;
	id: string;
	start: string;
	end: string | null;
	scope: VacationScope;
	createdDay: string;
	createdAt: string;
}

export interface Run {
	start: string;
	end: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** parseVacation: null for a row that is unusable (it is then ignored). */
export function parseVacation(key: string, raw: unknown): VacationPeriod | null {
	if (!key.startsWith(VACATION_PREFIX) || !isRecord(raw)) return null;
	const id = key.slice(VACATION_PREFIX.length);
	if (raw.version !== 1 || id === '' || raw.id !== id) return null;
	if (!isDay(raw.start) || !isDay(raw.createdDay) || typeof raw.createdAt !== 'string') return null;
	let end: string | null = null;
	if (raw.end !== null) {
		if (!isDay(raw.end) || raw.end < raw.start) return null;
		end = raw.end;
	}
	let scope: VacationScope;
	if (raw.scope === 'all') scope = 'all';
	else if (
		isRecord(raw.scope) &&
		Array.isArray(raw.scope.workspaces) &&
		raw.scope.workspaces.length > 0 &&
		raw.scope.workspaces.every((w) => typeof w === 'number' && Number.isInteger(w))
	) {
		scope = { workspaces: [...(raw.scope.workspaces as number[])] };
	} else return null;
	return { version: 1, id, start: raw.start, end, scope, createdDay: raw.createdDay, createdAt: raw.createdAt };
}

function covers(p: VacationPeriod, workspaceId: number): boolean {
	return p.scope === 'all' || p.scope.workspaces.includes(workspaceId);
}

/** The dates a period contributes: [s, e], or null when empty. */
function effective(p: VacationPeriod, today: string): Run | null {
	const s = p.start > p.createdDay ? p.start : p.createdDay;
	const e = p.end ?? (today > s ? today : s);
	return e < s ? null : { start: s, end: e };
}

/** vacationRuns: the merged runs of consecutive vacation dates of one workspace. */
export function vacationRuns(
	periods: readonly VacationPeriod[],
	workspaceId: number,
	today: string
): Run[] {
	const ranges = periods
		.filter((p) => covers(p, workspaceId))
		.flatMap((p) => {
			const r = effective(p, today);
			return r === null ? [] : [r];
		})
		.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
	const runs: Run[] = [];
	for (const r of ranges) {
		const last = runs[runs.length - 1];
		if (last !== undefined && r.start <= addDays(last.end, 1)) {
			if (r.end > last.end) last.end = r.end;
		} else runs.push({ ...r });
	}
	return runs;
}

export function isVacationDay(runs: readonly Run[], day: string): boolean {
	return runs.some((r) => r.start <= day && day <= r.end);
}

export function currentVacation(runs: readonly Run[], today: string): Run | null {
	return runs.find((r) => r.start <= today && today <= r.end) ?? null;
}

export type VacationWrite = { put: VacationPeriod } | { delete: string };

export interface Draft {
	start: string | 'now';
	end: string | null;
	scope: VacationScope;
}

function scopeKey(s: VacationScope): string {
	return s === 'all' ? 'all' : [...new Set(s.workspaces)].sort((a, b) => a - b).join(',');
}

export function planCreate(
	existing: readonly VacationPeriod[],
	draft: Draft,
	o: {
		today: string;
		now: Date;
		reviewedToday: (workspaceId: number | 'all') => boolean;
		newId: () => string;
	}
): { writes: VacationWrite[]; startsTomorrow: boolean } | { error: string } {
	if (draft.scope !== 'all' && draft.scope.workspaces.length === 0) return { error: 'no-workspaces' };
	if (draft.start === '') return { error: 'start-missing' };
	let startsTomorrow = false;
	let start: string;
	if (draft.start === 'now') {
		const studied =
			draft.scope === 'all'
				? o.reviewedToday('all')
				: draft.scope.workspaces.some((w) => o.reviewedToday(w));
		startsTomorrow = studied;
		start = studied ? addDays(o.today, 1) : o.today;
	} else start = draft.start;
	if (!isDay(start) || start < o.today) return { error: 'start-before-today' };
	if (draft.end !== null) {
		if (!isDay(draft.end) || draft.end < start) {
			return { error: startsTomorrow ? 'end-before-start-tomorrow' : 'end-before-start' };
		}
		if (daysBetweenDates(start, draft.end) + 1 > MAX_DATES) return { error: 'too-long' };
	}

	const key = scopeKey(draft.scope);
	const touching = existing
		.filter((p) => scopeKey(p.scope) === key)
		.flatMap((p) => {
			const r = effective(p, o.today);
			if (r === null) return [];
			const touches =
				r.start <= (draft.end === null ? '9999-12-31' : addDays(draft.end, 1)) &&
				start <= addDays(r.end, 1);
			return touches ? [{ p, r }] : [];
		})
		.sort((a, b) => (a.r.start < b.r.start ? -1 : a.r.start > b.r.start ? 1 : a.p.id < b.p.id ? -1 : 1));

	if (touching.length === 0) {
		return {
			writes: [
				{
					put: {
						version: 1,
						id: o.newId(),
						start,
						end: draft.end,
						scope: draft.scope,
						createdDay: o.today,
						createdAt: o.now.toISOString().replace('.000Z', 'Z')
					}
				}
			],
			startsTomorrow
		};
	}
	const keep = touching[0].p;
	let mergedStart = start;
	let mergedEnd: string | null = draft.end;
	for (const { p, r } of touching) {
		if (r.start < mergedStart) mergedStart = r.start;
		if (p.end === null || mergedEnd === null) mergedEnd = null;
		else if (p.end > mergedEnd) mergedEnd = p.end;
	}
	const writes: VacationWrite[] = [{ put: { ...keep, start: mergedStart, end: mergedEnd } }];
	for (const { p } of touching.slice(1)) writes.push({ delete: p.id });
	return { writes, startsTomorrow };
}

/** Ending today: a started period gets `end = today - 1`, others vanish. */
export function planEndEarly(period: VacationPeriod, today: string): VacationWrite {
	const r = effective(period, today);
	if (r !== null && r.start < today) return { put: { ...period, end: addDays(today, -1) } };
	return { delete: period.id };
}

/** Cancelling is only for periods that have not started. */
export function planCancel(period: VacationPeriod, today: string): VacationWrite | { error: string } {
	const r = effective(period, today);
	if (r !== null && r.start < today) return { error: 'started' };
	return { delete: period.id };
}
