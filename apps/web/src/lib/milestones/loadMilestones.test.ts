import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { EventLog } from '$lib/events';
import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('$lib/studycore/commands/keyed', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/commands/keyed')>()),
	saveSeenMilestones: vi.fn()
}));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn(), fetchSchemeCharacters: vi.fn() }));

import type { CharRow, Scheme } from '$lib/api/types';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { StudyEvent } from '$lib/events';
import { loadStudyHistory } from '$lib/studycore/data';
import { PartialPushError } from '$lib/sync/push';
import { saveSeenMilestones } from '$lib/studycore/commands/keyed';
import type { ReviewEvent, StudyCard, StudyHistory } from '$lib/studycore/types';
import { givenTimelines, replayStats } from '$lib/weekly/replay';
import { levelMilestoneId } from './catalogue';
import { flushOnOnline, loadMilestones, markSeen } from './loadMilestones';
import { addPending, readPending } from './seen';
import * as build from '$lib/testing/study';

// The session's StudyDays (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	vi.spyOn(StudyDays.prototype, 'effectiveHistory').mockImplementation((() => []) as never);
	vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

// The session's event log (record 0009): its methods, faked on the class.
let loadWorkspaceEvents!: MockInstance<EventLog['load']>;
beforeEach(() => {
	loadWorkspaceEvents = vi.spyOn(EventLog.prototype, 'load').mockImplementation(((async () => [])) as never);
});

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

const NOW = Date.parse('2026-11-17T12:00:00Z');
const WS = 3;

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

const card = (e: number, written?: string): StudyCard => build.card({ id: `c-vocab-${e}`, entryId: e, createdAt: 't', written });

/** 100 reviews on 10 cards over the last 10 days (reviews:100, words-studied:10, streak:3/7, days-active:10). */
function reviews(ws = WS): ReviewEvent[] {
	return Array.from({ length: 100 }, (_, i) =>
		build.review({
			id: `r${String(i).padStart(4, '0')}`,
			workspaceId: ws,
			ts: new Date(NOW - (10 - Math.floor(i / 10)) * 86_400_000 + (i % 10) * 60_000).toISOString(),
			cardId: `c-vocab-${(i % 10) + 1}`
		})
	);
}

function history(extra: Partial<StudyHistory> = {}): StudyHistory {
	return build.history({
		cards: Array.from({ length: 10 }, (_, i) => card(i + 1, '一二三四五六七八九十'[i])),
		reviews: reviews(),
		...extra
	});
}

const event = (id: string, type: string, payload: unknown, ws = WS): StudyEvent => ({
	id,
	workspaceId: ws,
	device: 'web',
	ts: new Date(NOW - 3_600_000).toISOString(),
	type,
	payload
});

function states(list: FeatureSwitch[] = [], status: 'ready' | 'loading' | 'error' | 'idle' = 'ready'): void {
	ctx.session.features.set({ list, status });
}

const ids = (list: { id: string }[]) => list.map((x) => x.id);

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	states();
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
	vi.mocked(loadWorkspaceEvents).mockResolvedValue([
		event('e1', 'read', { seconds: 3600 }),
		event('e2', 'journal', { entryId: 'J1' }),
		event('e3', 'journal', { entryId: 'J9' }, 4)
	]);
	vi.mocked(saveSeenMilestones).mockResolvedValue('done');
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('loadMilestones', () => {
	it('home: the log families, a summary card for a long history, no replay', async () => {
		const built = replayStats.timelines;
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(view.plan.kind).toBe('summary');
		expect(view.plan.kind !== 'none' && [...view.plan.ids].sort()).toEqual(
			['days-active:10', 'journal-entries:1', 'reading-hours:1', 'reviews:100', 'streak:3', 'streak:7', 'words-studied:10'].sort()
		);
		expect(view.titles.get('reviews:100')).toBe('100 reviews');
		expect(replayStats.timelines).toBe(built);
		expect(getSchemes).not.toHaveBeenCalled();
		expect(fetchSchemeCharacters).not.toHaveBeenCalled();
	});

	it('an event of another workspace is never counted', async () => {
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(ids(view.reached)).not.toContain('journal-entries:10');
		expect(ids(view.reached).filter((id) => id.startsWith('journal'))).toEqual(['journal-entries:1']);
	});

	it('plugin states not ready: no card, the history lists only seen rows', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ seenMilestones: new Map([['reviews:100', { id: 'reviews:100', seenAt: null, reachedDay: '2026-11-08' }]]) })
		);
		for (const status of ['idle', 'loading', 'error'] as const) {
			states([], status);
			const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'week', now: NOW, language: 'zh' });
			expect(view.plan).toEqual({ kind: 'none' });
			expect(view.history).toEqual([{ id: 'reviews:100', day: '2026-11-08', isNew: false }]);
		}
	});

	it('the journal plugin off drops journal-entries; the reader off drops reading-hours', async () => {
		states([{ id: 'journal', enabled: false }, { id: 'reader', enabled: false }]);
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(ids(view.reached)).not.toContain('journal-entries:1');
		expect(ids(view.reached)).not.toContain('reading-hours:1');
		expect(ids(view.reached)).toContain('days-active:10');
	});

	it('flashcards off drops the review families; days-active stays', async () => {
		states([{ id: 'flashcards', enabled: false }]);
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(ids(view.reached).sort()).toEqual(['days-active:10', 'journal-entries:1', 'reading-hours:1']);
	});

	it('seen rows and pending ids show no card', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				seenMilestones: new Map(
					['reviews:100', 'streak:3', 'streak:7', 'days-active:10'].map((id) => [id, { id, seenAt: null, reachedDay: null }])
				)
			})
		);
		addPending(1, WS, ['words-studied:10', 'reading-hours:1', 'journal-entries:1'].map((id) => ({ id, seenAt: null, reachedDay: '2026-11-10' })));
		vi.mocked(saveSeenMilestones).mockRejectedValue(new PartialPushError('offline', 0));
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(view.plan).toEqual({ kind: 'none' });
	});

	it('flushes the pending list once; a rejected push keeps it', async () => {
		addPending(1, WS, [{ id: 'streak:3', seenAt: '2026-11-16T08:00:00.000Z', reachedDay: '2026-11-09' }]);
		vi.mocked(saveSeenMilestones).mockRejectedValue(new PartialPushError('offline', 0));
		await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(saveSeenMilestones).toHaveBeenCalledTimes(1);
		expect(vi.mocked(saveSeenMilestones).mock.calls[0]).toEqual([
			ctx.session.study,
			WS,
			[{ key: 'milestone:streak:3', data: { version: 1, id: 'streak:3', seenAt: '2026-11-16T08:00:00.000Z', reachedDay: '2026-11-09' } }]
		]);
		expect(ids(readPending(1, WS))).toEqual(['streak:3']);
	});

	it('a successful flush empties the pending list; a pending id already live is pruned without a push', async () => {
		addPending(1, WS, [{ id: 'streak:3', seenAt: null, reachedDay: '2026-11-09' }]);
		await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(readPending(1, WS)).toEqual([]);
		vi.clearAllMocks();
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ seenMilestones: new Map([['streak:7', { id: 'streak:7', seenAt: null, reachedDay: null }]]) }));
		vi.mocked(loadWorkspaceEvents).mockResolvedValue([]);
		addPending(1, WS, [{ id: 'streak:7', seenAt: null, reachedDay: null }]);
		await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(saveSeenMilestones).not.toHaveBeenCalled();
		expect(readPending(1, WS)).toEqual([]);
	});

	it('back online: flushes the pending ids against the live rows of the last load, never rewriting a live row', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ seenMilestones: new Map([['reviews:100', { id: 'reviews:100', seenAt: null, reachedDay: '2026-11-08' }]]) })
		);
		await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		vi.mocked(saveSeenMilestones).mockClear();
		addPending(1, WS, ['reviews:100', 'streak:3'].map((id) => ({ id, seenAt: null, reachedDay: '2026-11-10' })));
		await flushOnOnline(ctx.session);
		expect(saveSeenMilestones).toHaveBeenCalledTimes(1);
		expect(vi.mocked(saveSeenMilestones).mock.calls[0][2].map((r) => r.key)).toEqual(['milestone:streak:3']);
	});

	it('a load still in flight at the session end leaves no place to flush into (#173)', async () => {
		let release: (h: StudyHistory) => void = () => undefined;
		vi.mocked(loadStudyHistory).mockReturnValue(new Promise((r) => (release = r)));
		const late = loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		newSession(ctx);
		release(history());
		await late;
		vi.mocked(saveSeenMilestones).mockClear();
		addPending(1, WS, [{ id: 'streak:3', seenAt: null, reachedDay: null }]);
		await flushOnOnline(ctx.session);
		expect(saveSeenMilestones).not.toHaveBeenCalled();
	});

	it('back online before any load: nothing is flushed', async () => {
		addPending(1, WS, [{ id: 'streak:3', seenAt: null, reachedDay: null }]);
		await flushOnOnline(ctx.session);
		expect(saveSeenMilestones).not.toHaveBeenCalled();
	});

	it('each call reads only its workspace pending list', async () => {
		addPending(1, 4, [{ id: 'reviews:100', seenAt: null, reachedDay: null }]);
		addPending(2, WS, [{ id: 'reviews:100', seenAt: null, reachedDay: null }]);
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(view.plan.kind !== 'none' && view.plan.ids).toContain('reviews:100');
		expect(saveSeenMilestones).not.toHaveBeenCalled();
	});

	it('week: replay families from the given timelines, levels loaded with their names', async () => {
		const timelines = givenTimelines(
			Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`c-vocab-${i + 1}`, [{ ts: '2026-11-15T09:00:00Z', state: 2, stability: 200 }]]))
		);
		const chars = Array.from('一二三四五六七八九十').map((c, i) => ({ i: 100 + i, c }) as CharRow);
		const schemes: Scheme[] = [
			{ id: 1, name: 'HSK Words', unit: 'word', language: 'zh', packId: 'hsk-words', levels: [{ id: 11, name: 'HSK 1', ord: 1 }] } as Scheme,
			{ id: 2, name: 'TGH', unit: 'character', language: 'zh', packId: 'tgh-chars', levels: [{ id: 21, name: 'Level 1', ord: 1 }] } as Scheme,
			{ id: 3, name: 'JLPT', unit: 'character', language: 'ja', packId: 'jlpt-kanji', levels: [{ id: 31, name: 'N5', ord: 1 }] } as Scheme
		];
		vi.mocked(getSchemes).mockResolvedValue(schemes);
		vi.mocked(getSchemeEntries).mockResolvedValue([1, 2, 3].map((id) => ({ id, kind: 'word' }) as never));
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([{ levelId: 21, name: 'Level 1', chars: new Set(['一', '二']) }]);
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'week', now: NOW, language: 'zh', week: { timelines, chars, cards: history().cards } });
		const hsk1 = levelMilestoneId('hsk-words', 'HSK 1');
		const level1 = levelMilestoneId('tgh-chars', 'Level 1');
		expect(ids(view.reached)).toEqual(expect.arrayContaining(['words-mature:10', 'characters-learned:10', hsk1, level1]));
		expect(view.titles.get(hsk1)).toBe('HSK Words · HSK 1 complete');
		expect(view.titles.get(level1)).toBe('TGH · Level 1 complete');
		expect(getSchemeEntries).toHaveBeenCalledWith(1, 'HSK 1');
		expect(fetchSchemeCharacters).toHaveBeenCalledWith(expect.anything(), 2);
		expect(view.history.filter((i) => i.isNew).length).toBe(view.reached.length);
	});

	it('week: levels that fail to load are left out, the rest still counts', async () => {
		vi.mocked(getSchemes).mockRejectedValue(new Error('offline'));
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'week', now: NOW, language: 'zh', week: { timelines: givenTimelines({}), chars: null, cards: history().cards } });
		expect(ids(view.reached)).toContain('reviews:100');
	});
});

describe('markSeen', () => {
	it('pushes the rows of every covered id, then drops them from the pending list', async () => {
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		await markSeen(ctx.session, view);
		const [, ws, rows] = vi.mocked(saveSeenMilestones).mock.calls[0];
		expect(ws).toBe(WS);
		expect(rows.map((r) => r.key).sort()).toEqual(view.plan.kind === 'none' ? [] : view.plan.ids.map((id) => `milestone:${id}`).sort());
		expect(readPending(1, WS)).toEqual([]);
	});

	it('offline: the ids stay pending and the next load shows no card', async () => {
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		vi.mocked(saveSeenMilestones).mockRejectedValue(new PartialPushError('offline', 0));
		await expect(markSeen(ctx.session, view)).resolves.toBeUndefined();
		expect(ids(readPending(1, WS)).sort()).toEqual(view.plan.kind === 'none' ? [] : [...view.plan.ids].sort());
		const next = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(next.plan).toEqual({ kind: 'none' });
	});

	it('writes only ids whose row is not live', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ seenMilestones: new Map([['reviews:100', { id: 'reviews:100', seenAt: null, reachedDay: null }]]) }));
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		await markSeen(ctx.session, view);
		const rows = vi.mocked(saveSeenMilestones).mock.calls.at(-1)?.[2] ?? [];
		expect(rows.map((r) => r.key)).not.toContain('milestone:reviews:100');
	});

	it('writes into the workspace the view was loaded for', async () => {
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		expect(view.workspaceId).toBe(WS);
		vi.mocked(saveSeenMilestones).mockRejectedValue(new PartialPushError('offline', 0));
		await markSeen(ctx.session, { ...view, workspaceId: 9 });
		expect(vi.mocked(saveSeenMilestones).mock.calls.at(-1)?.[1]).toBe(9);
		expect(readPending(1, 9).length).toBeGreaterThan(0);
		expect(readPending(1, WS)).toEqual([]);
	});

	it('a skipped row keeps its id pending (seen here) until it is live in a pull', async () => {
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		vi.mocked(saveSeenMilestones).mockResolvedValue('pending');
		await markSeen(ctx.session, view);
		expect(ids(readPending(1, WS)).sort()).toEqual(view.plan.kind === 'none' ? [] : [...view.plan.ids].sort());
	});

	it('a tombstoned key is written with its tombstone stamp', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ milestoneTombstones: new Map([['reviews:100', '2026-11-17T11:00:00Z']]) }));
		const view = await loadMilestones(ctx.session, WS, { states: ctx.session.features, scope: 'home', now: NOW, language: 'zh' });
		await markSeen(ctx.session, view);
		const rows = vi.mocked(saveSeenMilestones).mock.calls.at(-1)?.[2] ?? [];
		expect(rows.find((r) => r.key === 'milestone:reviews:100')).toMatchObject({ knownAt: '2026-11-17T11:00:00Z' });
		expect(rows.find((r) => r.key === 'milestone:streak:3')).not.toHaveProperty('knownAt');
	});

	it('nothing to mark for no card', async () => {
		await markSeen(ctx.session, { workspaceId: WS, plan: { kind: 'none' }, history: [], titles: new Map(), reached: [], live: new Map() });
		expect(saveSeenMilestones).not.toHaveBeenCalled();
	});
});
