import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('../study/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('../api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('../stats/characterMap', () => ({ loadCharacterMapData: vi.fn(), withLegacyWritten: vi.fn() }));

import { fetchActivity, type ActivityResponse } from '../api/stats';
import { loadCharacterMapData, withLegacyWritten } from '../stats/characterMap';
import { DEFAULT_W } from '../study/fsrs/params';
import { loadStudyHistory } from '../study/data';
import { IDENTITY_CLOCK } from '../study/studyClock';
import type { ReviewEvent, StudyCard, StudyHistory } from '../study/types';
import { loadWeek, loadWeekCharacters } from './loadWeek';
import * as build from '$lib/testing/study';

// The session's StudyDays (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	vi.spyOn(StudyDays.prototype, 'effectiveHistory').mockImplementation((() => []) as never);
	vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

const NOW = Date.parse('2026-11-18T12:00:00Z');
const REVIEW_SOURCE = {
	type: 'review',
	plugin: 'qinqin-flashcards',
	label: 'Flashcard reviews',
	unit: 'count' as const,
	describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
};

function rv(n: number, cardId: string, ts: string, grade = 4): ReviewEvent {
	return build.review({ id: build.eventId(n, '01JLW'), workspaceId: 3, ts, cardId, grade });
}

const card = (id: string, written?: string): StudyCard => build.card({ id, createdAt: '2026-01-01T00:00:00Z', written });

// Easy every few days from September: mature well before November.
const longReviews = [0, 3, 10, 30, 70].map((d, i) =>
	rv(i + 1, 'old', new Date(Date.parse('2026-09-01T10:00:00Z') + d * 86_400_000).toISOString())
);
const weekReview = rv(50, 'a', '2026-11-10T10:00:00Z', 3);

function history(extra: Partial<StudyHistory> = {}): StudyHistory {
	return build.history({ cards: [card('old'), card('a')], reviews: [...longReviews, weekReview], ...extra });
}

const activity = (cells: ActivityResponse['cells']): ActivityResponse => ({
	from: '',
	to: '',
	timeZone: 'UTC',
	sources: [REVIEW_SOURCE],
	cells
});

beforeEach(() => {
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
	vi.mocked(fetchActivity).mockResolvedValue(
		activity([
			{ day: '2026-11-10', workspace: 3, type: 'review', points: 1, raw: 1 },
			{ day: '2026-11-10', workspace: 4, type: 'review', points: 9, raw: 9 }
		])
	);
});
afterEach(() => vi.clearAllMocks());

describe('loadWeek', () => {
	it('asks for 14 dates of the workspace: the week and the one before', async () => {
		const view = await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW });
		expect(fetchActivity).toHaveBeenCalledTimes(1);
		expect(fetchActivity).toHaveBeenCalledWith('2026-11-02', '2026-11-15', 3);
		expect(view.summary.rows.find((r) => r.key === 'reviews')?.value).toBe(1);
		expect(view.sources).toEqual([REVIEW_SOURCE]);
		expect(view.activityError).toBeNull();
	});

	it('clips the request to today in the current week', async () => {
		await loadWeek(ctx.session, 3, '2026-11-16', { now: NOW });
		expect(fetchActivity).toHaveBeenCalledWith('2026-11-09', '2026-11-18', 3);
	});

	it('keeps the local rows when the activity request fails', async () => {
		vi.mocked(fetchActivity).mockRejectedValue(new Error('You are offline.'));
		const view = await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW });
		expect(view.activityError).toBe('Could not load your activity.');
		expect(view.summary.rows.find((r) => r.key === 'reviews')?.value).toBeNull();
		expect(view.summary.rows.find((r) => r.key === 'newCards')?.value).toBe(1);
		expect(view.summary.daysActive.localOnly).toBe(true);
	});

	it('counts mature words only with detail, never loads characters', async () => {
		expect((await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW })).summary.mature).toBeNull();
		const detailed = await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW, detail: true });
		expect(detailed.summary.mature).toEqual({ value: 0, previous: 0 });
		expect(loadCharacterMapData).not.toHaveBeenCalled();
	});

	it('exposes the timelines it built with detail (the milestones reuse them), none without', async () => {
		expect((await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW })).timelines).toBeUndefined();
		const detailed = await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW, detail: true });
		expect(detailed.timelines?.of('old').length).toBe(longReviews.length);
	});

	it('passes force to the study history', async () => {
		await loadWeek(ctx.session, 3, '2026-11-09', { now: NOW, force: true });
		expect(loadStudyHistory).toHaveBeenCalledWith(expect.anything(), 3, { force: true });
	});
});

describe('loadWeekCharacters', () => {
	it('is null outside Han languages without loading the universe', async () => {
		expect(await loadWeekCharacters(ctx.session, 3, 'es', '2026-11-09', { now: NOW })).toBeNull();
		expect(loadCharacterMapData).not.toHaveBeenCalled();
	});

	it('counts characters learned in the week and the one before', async () => {
		const reviews = [...longReviews];
		vi.mocked(loadCharacterMapData).mockResolvedValue({
			list: { chars: [{ i: 1, c: '好' }] },
			cards: [card('old')],
			reviews,
			w: DEFAULT_W,
			clock: IDENTITY_CLOCK
		} as unknown as Awaited<ReturnType<typeof loadCharacterMapData>>);
		vi.mocked(withLegacyWritten).mockResolvedValue({ cards: [card('old', '好')], unresolved: 0 });
		const out = await loadWeekCharacters(ctx.session, 3, 'zh', '2026-11-09', { now: NOW });
		expect(loadCharacterMapData).toHaveBeenCalledWith(expect.anything(), 3, 'zh', { force: false });
		expect(withLegacyWritten).toHaveBeenCalledTimes(1);
		const { universe, ...pair } = out!;
		expect(pair).toEqual({ value: 0, previous: 0 });
		// The universe and the resolved cards it scored, for the milestones.
		expect(universe.chars).toEqual([{ i: 1, c: '好' }]);
		expect(universe.cards).toEqual([card('old', '好')]);
		expect(universe.timelines.of('old').length).toBe(longReviews.length);
	});
});
