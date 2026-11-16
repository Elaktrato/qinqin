// Texts and small rules of the vacation settings (pure; the component is thin).

import type { StudyDay } from '$lib/time/studyDay';
import { currentVacation, vacationRuns, type Run, type VacationPeriod } from '$lib/study/vacation';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Jan", or "3 Jan 2027" when the year is not today's. */
function dateLabel(day: string, today: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const base = `${d} ${MONTHS[m - 1]}`;
	return String(y) === today.slice(0, 4) ? base : `${base} ${y}`;
}

export interface NamedWorkspace {
	id: number;
	name: string;
}

function scopeLabel(scope: VacationPeriod['scope'], spaces: readonly NamedWorkspace[]): string {
	if (scope === 'all') return 'all workspaces';
	const names = new Map(spaces.map((w) => [w.id, w.name]));
	const ids = [...scope.workspaces].sort((a, b) => a - b);
	return ids.map((id) => names.get(id) ?? `Workspace ${id}`).join(', ');
}

/** describePeriod: "3 Jan – 17 Jan, all workspaces". */
export function describePeriod(
	period: VacationPeriod,
	today: string,
	spaces: readonly NamedWorkspace[]
): string {
	const where = scopeLabel(period.scope, spaces);
	if (period.end === null) return `from ${dateLabel(period.start, today)} until you end it, ${where}`;
	return `${dateLabel(period.start, today)} – ${dateLabel(period.end, today)}, ${where}`;
}

/** The first day a period freezes: the createdDay clamp applies. */
function firstDay(period: VacationPeriod): string {
	return period.start > period.createdDay ? period.start : period.createdDay;
}

export function periodStatus(
	period: VacationPeriod,
	today: string
): 'scheduled' | 'active' | 'past' {
	if (firstDay(period) > today) return 'scheduled';
	if (period.end !== null && period.end < today) return 'past';
	return 'active';
}

export interface VacationState {
	run: Run;
	/** An open-ended period holds today. */
	open: boolean;
}

/** vacationStatus: today's run of one workspace, or null. */
export function vacationStatus(
	periods: readonly VacationPeriod[],
	workspaceId: number,
	today: string
): VacationState | null {
	const run = currentVacation(vacationRuns(periods, workspaceId, today), today);
	if (run === null) return null;
	const open = periods.some(
		(p) =>
			p.end === null &&
			(p.scope === 'all' || p.scope.workspaces.includes(workspaceId)) &&
			firstDay(p) <= today
	);
	return { run, open };
}

export function vacationBanner(state: VacationState | null, today: string): string | null {
	if (state === null) return null;
	if (state.open) return 'On vacation (no end date)';
	return `Vacation until ${dateLabel(state.run.end, today)}`;
}

/** The home widget's line: "On vacation until 3 Jan". */
export function vacationLine(state: VacationState | null, today: string): string | null {
	if (state === null) return null;
	if (state.open) return 'On vacation (no end date)';
	return `On vacation until ${dateLabel(state.run.end, today)}`;
}

export function startNowNote(startsTomorrow: boolean): string {
	return startsTomorrow ? 'Starts tomorrow — you already studied today' : '';
}

const ERRORS: Record<string, string> = {
	'start-before-today': 'The start cannot be in the past.',
	'start-missing': 'Choose a start date.',
	'end-before-start-tomorrow':
		'Your vacation starts tomorrow because you already studied today; the end cannot be before that.',
	'end-before-start': 'The end must not be before the start.',
	'too-long': 'A vacation can be at most 366 days.',
	'no-workspaces': 'Choose at least one workspace.',
	started: 'A vacation that has started can only be ended.'
};

export function errorText(code: string): string {
	return ERRORS[code] ?? 'Could not save the vacation.';
}

/** reviewedTodayIn: whether a workspace (or any) has a review on the learner's today. */
export function reviewedTodayIn(
	stamps: ReadonlyMap<number, readonly number[]>,
	day: Pick<StudyDay, 'dayOf'>,
	now: number
): (workspaceId: number | 'all') => boolean {
	const today = day.dayOf(now);
	const has = (id: number): boolean => (stamps.get(id) ?? []).some((t) => day.dayOf(t) === today);
	return (workspaceId) =>
		workspaceId === 'all' ? [...stamps.keys()].some(has) : has(workspaceId);
}
