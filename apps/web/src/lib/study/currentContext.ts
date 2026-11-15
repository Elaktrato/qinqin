// The StudyContext of the signed-in learner for one workspace: the learner's
// zone history plus the workspace's vacation runs. A context is a snapshot of
// "today", so `onContextStale` tells pages when to rebuild it (the learner's
// midnight, a zone change).

import { addDays } from '../time/studyDay';
import { currentStudyDay, currentStudyHistory, onStudyDayChange } from '../time/zone';
import { contextFor, type StudyContext } from './studyContext';
import { vacationRuns, type Run, type VacationPeriod } from './vacation';

/** currentContext builds a context for explicit runs (no vacation rows read). */
export function currentContext(runs: readonly Run[] = [], now: number = Date.now()): StudyContext {
	return contextFor(currentStudyDay(), runs, now, currentStudyHistory());
}

/** contextForData builds the context of `workspaceId` from loaded study data. */
export function contextForData(
	data: { vacations?: readonly VacationPeriod[] },
	workspaceId: number,
	now: number = Date.now()
): StudyContext {
	const today = currentStudyDay().today(now);
	return currentContext(vacationRuns(data.vacations ?? [], workspaceId, today), now);
}

const MAX_TIMER = 2_147_483_647;

/**
 * onContextStale calls `listener` whenever a context built now stops being
 * right: at the learner's next midnight (re-armed each time) and on a zone
 * change. Returns the unsubscribe.
 */
export function onContextStale(listener: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	const arm = (): void => {
		if (stopped) return;
		const now = Date.now();
		const day = currentStudyDay();
		const next = day.dayStart(addDays(day.today(now), 1));
		const delay = Math.min(Math.max(next - now + 50, 1000), MAX_TIMER);
		timer = setTimeout(() => {
			if (stopped) return;
			// A capped wait that has not reached midnight yet only re-arms.
			if (Date.now() >= next) listener();
			arm();
		}, delay);
	};
	const offZone = onStudyDayChange(() => {
		listener();
		if (timer !== null) clearTimeout(timer);
		arm();
	});
	arm();
	return () => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		offZone();
	};
}
