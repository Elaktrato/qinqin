import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('../api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('../stats/characterMap', () => ({ loadCharacterMapData: vi.fn(), withLegacyWritten: vi.fn() }));
vi.mock('../time/zone', async () => {
	const { studyDay } = await import('../time/studyDay');
	return { currentStudyDay: () => studyDay([]), currentStudyHistory: () => [], onStudyDayChange: () => () => {} };
});

import { fetchActivity, type ActivityResponse } from '../api/stats';
import { loadCharacterMapData, withLegacyWritten } from '../stats/characterMap';
import { DEFAULT_W } from '../study/fsrs/params';
import { loadStudyHistory } from '../study/history';
import { IDENTITY_CLOCK } from '../study/studyClock';
import type { ReviewEvent, StudyCard, StudyHistory } from '../study/types';
import { loadWeek, loadWeekCharacters } from './loadWeek';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const REVIEW_SOURCE = {
	type: 'review',
	plugin: 'qinqin-flashcards',
	label: 'Flashcard reviews',
	unit: 'count' as const,
	describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
};

function rv(n: number, cardId: string, ts: string, grade = 4): ReviewEvent {
	return {
		id: `01JLW${String(n).padStart(21, '0')}`,
		workspaceId: 3,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	} as ReviewEvent;
}

const card = (id: string, written?: string): StudyCard => ({
	id,
	kind: 'vocab',
	entryId: 1,
	deckIds: ['general'],
	createdAt: '2026-01-01T00:00:00Z',
	...(written === undefined ? {} : { written })
});

// Easy every few days from September: mature well before November.
const longReviews = [0, 3, 10, 30, 70].map((d, i) =>
	rv(i + 1, 'old', new Date(Date.parse('2026-09-01T10:00:00Z') + d * 86_400_000).toISOString())
);
const weekReview = rv(50, 'a', '2026-11-10T10:00:00Z', 3);

function history(extra: Partial<StudyHistory> = {}): StudyHistory {
	return { decks: [], cards: [card('old'), card('a')], reviews: [...longReviews, weekReview], merged: 0, ...extra };
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
		const view = await loadWeek(3, '2026-11-09', { now: NOW });
		expect(fetchActivity).toHaveBeenCalledTimes(1);
		expect(fetchActivity).toHaveBeenCalledWith('2026-11-02', '2026-11-15', 3);
		expect(view.summary.rows.find((r) => r.key === 'reviews')?.value).toBe(1);
		expect(view.sources).toEqual([REVIEW_SOURCE]);
		expect(view.activityError).toBeNull();
	});

	it('clips the request to today in the current week', async () => {
		await loadWeek(3, '2026-11-16', { now: NOW });
		expect(fetchActivity).toHaveBeenCalledWith('2026-11-09', '2026-11-18', 3);
	});

	it('keeps the local rows when the activity request fails', async () => {
		vi.mocked(fetchActivity).mockRejectedValue(new Error('You are offline.'));
		const view = await loadWeek(3, '2026-11-09', { now: NOW });
		expect(view.activityError).toBe('You are offline.');
		expect(view.summary.rows.find((r) => r.key === 'reviews')?.value).toBeNull();
		expect(view.summary.rows.find((r) => r.key === 'newCards')?.value).toBe(1);
		expect(view.summary.daysActive.localOnly).toBe(true);
	});

	it('counts mature words only with detail, never loads characters', async () => {
		expect((await loadWeek(3, '2026-11-09', { now: NOW })).summary.mature).toBeNull();
		const detailed = await loadWeek(3, '2026-11-09', { now: NOW, detail: true });
		expect(detailed.summary.mature).toEqual({ value: 0, previous: 0 });
		expect(loadCharacterMapData).not.toHaveBeenCalled();
	});

	it('passes force to the study history', async () => {
		await loadWeek(3, '2026-11-09', { now: NOW, force: true });
		expect(loadStudyHistory).toHaveBeenCalledWith(3, { force: true });
	});
});

describe('loadWeekCharacters', () => {
	it('is null outside Han languages without loading the universe', async () => {
		expect(await loadWeekCharacters(3, 'es', '2026-11-09', { now: NOW })).toBeNull();
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
		const out = await loadWeekCharacters(3, 'zh', '2026-11-09', { now: NOW });
		expect(loadCharacterMapData).toHaveBeenCalledWith(3, 'zh', { force: false });
		expect(withLegacyWritten).toHaveBeenCalledTimes(1);
		expect(out).toEqual({ value: 0, previous: 0 });
	});
});
