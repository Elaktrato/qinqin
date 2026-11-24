// The one I/O of the weekly summary: the workspace's cached study history,
// one 14-day activity request per shown week (the week and the one before)
// and, on the Week tab only, the language's character universe. Failures
// of the activity request leave the local rows (offline).

import { errorText } from '$lib/api/apiErrors';
import { fetchActivity, type ActivitySource } from '../api/stats';
import { t } from '../i18n';
import type { GoalsRow } from '../goals/goals';
import { usesHan } from '../languages';
import { loadCharacterMapData, withLegacyWritten } from '../stats/characterMap';
import { contextForData } from '../study/currentContext';
import { loadStudyHistory } from '../study/data';
import { GENERAL_DECK_ID } from '../study/types';
import { activeWeights } from '../study/readModel';
import { vacationRuns } from '../study/vacation';
import { addDays } from '../time/studyDay';
import { currentStudyDay } from '../time/zone';
import type { CharRow } from '../api/types';
import type { StudyCard } from '../study/types';
import { charactersLearned, timelinesFor, wordsReachingMature, type Timelines } from './replay';
import { weekCutoffs, weekSummary, type Pair, type WeekSummary } from './summary';
import { previousWeek } from './week';

export interface WeekView {
	summary: WeekSummary;
	sources: ActivitySource[];
	/** The activity request failed: its rows are unavailable, the local rows are shown. */
	activityError: string | null;
	/** With `detail`: the timelines it built (the milestones sweep them, no second replay). */
	timelines?: Timelines;
}

/** Characters learned in the week, and what they were counted from (the milestones reuse it). */
export interface WeekCharacters extends Pair {
	universe: { chars: readonly CharRow[]; cards: StudyCard[]; timelines: Timelines };
}

/** The parsed goal row; a newer version's row counts as none. */
function goalsOf(goals: GoalsRow | 'newer' | undefined): GoalsRow | null {
	return goals === undefined || goals === 'newer' ? null : goals;
}

/**
 * loadWeek: the summary of the week starting `monday` in one workspace.
 * `detail` adds the words reaching mature (one replay per loaded history).
 */
export async function loadWeek(
	workspaceId: number,
	monday: string,
	opts?: { force?: boolean; now?: number; detail?: boolean }
): Promise<WeekView> {
	const now = opts?.now ?? Date.now();
	const day = currentStudyDay();
	const today = day.today(now);
	const data = await loadStudyHistory(workspaceId, { force: opts?.force === true });
	const sunday = addDays(monday, 6);
	let activity: { sources: ActivitySource[]; cells: Awaited<ReturnType<typeof fetchActivity>>['cells'] } | null = null;
	let activityError: string | null = null;
	try {
		const response = await fetchActivity(previousWeek(monday), sunday < today ? sunday : today, workspaceId);
		activity = { sources: response.sources ?? [], cells: response.cells ?? [] };
	} catch (err) {
		activityError = errorText(err, t('stats.activity.loadFailed'));
	}
	let mature: ((before: number, after: number) => number) | undefined;
	let timelines: Timelines | undefined;
	if (opts?.detail === true) {
		const clock = contextForData(data, workspaceId, now).clock;
		const t = timelinesFor(data.reviews, activeWeights(data), clock);
		timelines = t;
		const decks = new Set([GENERAL_DECK_ID, ...data.decks.map((d) => d.id)]);
		mature = (before, after) => wordsReachingMature(data.cards, decks, t, before, after);
	}
	const summary = weekSummary({
		monday,
		now,
		day,
		workspaceId,
		reviews: data.reviews,
		vacation: vacationRuns(data.vacations ?? [], workspaceId, today),
		activity,
		goals: goalsOf(data.goals),
		mature
	});
	return { summary, sources: activity?.sources ?? [], activityError, ...(timelines === undefined ? {} : { timelines }) };
}

/**
 * loadWeekCharacters: characters learned in the week and its comparison
 * window, Han languages only (null otherwise). Shares the replay with
 * loadWeek through the cached history's reviews array. `universe` is what
 * they were counted from (the milestones sweep it).
 */
export async function loadWeekCharacters(
	workspaceId: number,
	language: string,
	monday: string,
	opts?: { force?: boolean; now?: number }
): Promise<WeekCharacters | null> {
	if (!usesHan(language)) return null;
	const now = opts?.now ?? Date.now();
	const data = await loadCharacterMapData(workspaceId, language, { force: opts?.force === true });
	// Cards added before written snapshots existed are resolved as the map does.
	const cards = data.cards.some((c) => c.written === undefined)
		? (await withLegacyWritten(data.cards)).cards
		: data.cards;
	const t = timelinesFor(data.reviews, data.w, data.clock);
	const day = currentStudyDay();
	const cuts = weekCutoffs(monday, day.today(now), day);
	return {
		value: charactersLearned(data.list.chars, cards, t, ...cuts.week),
		previous: charactersLearned(data.list.chars, cards, t, ...cuts.previous),
		universe: { chars: data.list.chars, cards, timelines: t }
	};
}
