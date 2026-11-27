import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadStudyHistory } = vi.hoisted(() => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/studycore/data', async (original) => ({
	...(await original<typeof import('$lib/studycore/data')>()),
	loadStudyHistory
}));

import type { StudyEventBody } from '$lib/api/types';
import { grammarPayload } from '$lib/events/eventPayloads';
import { grammarRunsOf } from '$lib/studycore/grammarRuns';
import { loadProgress, progressKey, recordRun, runEvent } from './progress';

const NOW = Date.parse('2026-11-27T10:00:00.250Z');

function history(events: { id: string; ts: string; payload: unknown }[]) {
	return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: grammarRunsOf(7, events.map((e) => ({ ...e, workspaceId: 7, device: 'web', type: 'grammar' }))) };
}

function session(recorded: (event: StudyEventBody) => StudyEventBody | null = (e) => e) {
	return { study: {} as never, outbox: { recordEvent: vi.fn(async (event: StudyEventBody) => recorded(event)) } };
}

beforeEach(() => {
	loadStudyHistory.mockReset();
});

describe('lesson progress from the grammar events (#277)', () => {
	it('loadProgress replays the runs of the workspace history by lesson', async () => {
		loadStudyHistory.mockResolvedValue(
			history([
				{ id: 'a', ts: '2026-11-19T08:00:00Z', payload: grammarPayload('p', 'one', 3, 4) },
				{ id: 'b', ts: '2026-11-20T08:00:00Z', payload: grammarPayload('p', 'one', 1, 4) },
				{ id: 'c', ts: '2026-11-20T09:00:00Z', payload: grammarPayload('p', 'two', 2, 2) }
			])
		);
		const s = session();
		const map = await loadProgress(s, 7);
		expect(loadStudyHistory).toHaveBeenCalledWith(s.study, 7, {});
		expect(Object.fromEntries(map)).toEqual({
			[progressKey('p', 'one')]: { best: 3, total: 4, completedAt: '2026-11-20T08:00:00Z', runs: 2 },
			[progressKey('p', 'two')]: { best: 2, total: 2, completedAt: '2026-11-20T09:00:00Z', runs: 1 }
		});
	});

	it('runEvent is a grammar event of the workspace with the pinned payload', () => {
		const event = runEvent(7, 'p', 'one', 3, 4, NOW);
		expect(event).toMatchObject({ workspaceId: 7, device: 'web', ts: '2026-11-27T10:00:00.250Z', type: 'grammar' });
		expect(JSON.stringify(event.payload)).toBe('{"point":"p:one","mode":"lesson","score":3,"total":4}');
		expect(event.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
	});

	it('recordRun records through the outbox and answers the progress with this run', async () => {
		const s = session();
		const previous = { best: 3, total: 4, completedAt: '2026-11-20T08:00:00Z', runs: 2 };
		const p = await recordRun(s, 7, 'p', 'one', 2, 4, previous, NOW);
		expect(s.outbox.recordEvent).toHaveBeenCalledTimes(1);
		expect(p).toEqual({ best: 3, total: 4, completedAt: '2026-11-27T10:00:00.250Z', runs: 3 });
		// Another number of exercises starts over.
		expect(await recordRun(s, 7, 'p', 'one', 1, 5, previous, NOW)).toMatchObject({ best: 1, total: 5 });
		expect(await recordRun(s, 7, 'p', 'one', 1, 5, undefined, NOW)).toMatchObject({ best: 1, total: 5, runs: 1 });
	});

	it('recordRun throws when the run was not kept (its workspace was deleted)', async () => {
		await expect(recordRun(session(() => null), 7, 'p', 'one', 2, 4, undefined, NOW)).rejects.toThrow();
	});
});
