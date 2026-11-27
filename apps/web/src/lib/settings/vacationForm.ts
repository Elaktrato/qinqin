// Texts and small rules of the vacation settings (pure; the component is thin).

import { t, type MessageKey } from '$lib/i18n';
import { formatDay } from '$lib/i18n/format';
import type { StudyDay } from '$lib/time/studyDay';
import { currentVacation, vacationRuns, type Run, type VacationPeriod } from '$lib/studycore/vacation';

/** "3 Jan", or "3 Jan 2027" when the year is not today's (the format locale's short day). */
function dateLabel(day: string, today: string): string {
	const sameYear = day.slice(0, 4) === today.slice(0, 4);
	return formatDay(day, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface NamedWorkspace {
	id: number;
	name: string;
}

function scopeLabel(scope: VacationPeriod['scope'], spaces: readonly NamedWorkspace[]): string {
	if (scope === 'all') return t('settings.vacation.allWorkspaces');
	const names = new Map(spaces.map((w) => [w.id, w.name]));
	const ids = [...scope.workspaces].sort((a, b) => a - b);
	return ids.map((id) => names.get(id) ?? t('settings.vacation.workspaceN', { id })).join(', ');
}

/** describePeriod: "3 Jan – 17 Jan, all workspaces". */
export function describePeriod(
	period: VacationPeriod,
	today: string,
	spaces: readonly NamedWorkspace[]
): string {
	const where = scopeLabel(period.scope, spaces);
	if (period.end === null) return t('settings.vacation.openPeriod', { start: dateLabel(period.start, today), where });
	return t('settings.vacation.period', { start: dateLabel(period.start, today), end: dateLabel(period.end, today), where });
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
	if (state.open) return t('settings.vacation.openEnded');
	return t('settings.vacation.until', { date: dateLabel(state.run.end, today) });
}

/** The home widget's line: "On vacation until 3 Jan". */
export function vacationLine(state: VacationState | null, today: string): string | null {
	if (state === null) return null;
	if (state.open) return t('settings.vacation.openEnded');
	return t('settings.vacation.onUntil', { date: dateLabel(state.run.end, today) });
}

export function startNowNote(startsTomorrow: boolean): string {
	return startsTomorrow ? t('settings.vacation.startsTomorrow') : '';
}

const ERRORS: Record<string, MessageKey> = {
	'start-before-today': 'settings.vacation.error.startBeforeToday',
	'start-missing': 'settings.vacation.error.startMissing',
	'end-before-start-tomorrow': 'settings.vacation.error.endBeforeStartTomorrow',
	'end-before-start': 'settings.vacation.error.endBeforeStart',
	'too-long': 'settings.vacation.error.tooLong',
	'no-workspaces': 'settings.vacation.error.noWorkspaces',
	started: 'settings.vacation.error.started'
};

export function errorText(code: string): string {
	return t(Object.hasOwn(ERRORS, code) ? ERRORS[code] : 'settings.vacation.error.failed');
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
