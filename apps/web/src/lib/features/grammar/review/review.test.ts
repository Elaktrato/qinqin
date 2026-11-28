import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadStudyHistory, listGrammar } = vi.hoisted(() => ({ loadStudyHistory: vi.fn(), listGrammar: vi.fn() }));
vi.mock('$lib/studycore/data', async (original) => ({
	...(await original<typeof import('$lib/studycore/data')>()),
	loadStudyHistory
}));
vi.mock('../api', () => ({ listGrammar }));

import type { StudyEventBody } from '$lib/api/types';
import { grammarPayload } from '$lib/events/eventPayloads';
import { grammarRunsOf } from '$lib/studycore/grammarRuns';
import type { Example, Lesson, PackInfo } from '../types';
import { candidatePoints, loadReview, pointStatus, recordReview, reviewEvent, reviewExercises } from './review';

const NOW = Date.parse('2026-11-27T10:00:00.250Z');

function example(id: string, over: Partial<Example> = {}): Example {
	return { id, text: '我是学生。', reading: '', translation: 'I am a student.', focus: '是', distractors: ['很', '在'], ...over };
}

function lesson(examples: Example[]): Lesson {
	return { id: 'shi', level: 'a1', title: 't', summary: 's', pattern: [], body: [], examples };
}

function pack(packId: string, lessons: string[]): PackInfo {
	return {
		packId,
		name: packId,
		version: '1',
		language: 'zh',
		license: 'CC BY 4.0',
		attribution: 'a',
		notice: '',
		levels: [{ id: 'a1', name: 'A1', schemeLevels: [] }],
		lessons: lessons.map((id) => ({ id, level: 'a1', title: id, summary: '', examples: 3 }))
	};
}

function zone() {
	return { day: () => ({ zone: 'UTC', dayOf: (ms: number) => new Date(ms).toISOString().slice(0, 10), dayStart: () => 0, today: (n?: number) => new Date(n ?? NOW).toISOString().slice(0, 10) }), effectiveHistory: () => [], onChange: () => () => {} };
}

function session(recorded: (event: StudyEventBody) => StudyEventBody | null = (e) => e) {
	return { study: {} as never, zone: zone() as never, outbox: { recordEvent: vi.fn(async (event: StudyEventBody) => recorded(event)) } };
}

function history(events: { id: string; ts: string; payload: unknown }[]) {
	return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: grammarRunsOf(7, events.map((e) => ({ ...e, workspaceId: 7, device: 'web', type: 'grammar' }))) };
}

beforeEach(() => {
	loadStudyHistory.mockReset();
	listGrammar.mockReset();
});

describe('candidatePoints', () => {
	it('lists the installed lessons as points, in pack and lesson order', () => {
		expect(candidatePoints([pack('p', ['one', 'two']), pack('q', ['one'])])).toEqual(['p:one', 'p:two', 'q:one']);
		expect(candidatePoints([{ ...pack('p', []), lessons: undefined }])).toEqual([]);
	});
});

describe('reviewExercises', () => {
	const six = lesson([1, 2, 3, 4, 5, 6].map((n) => example(`e${n}`)));

	it('asks the picked examples, clozes with the focus and the authored distractors', () => {
		const first = reviewExercises(six, 0);
		expect(first.map((e) => [e.kind, e.example.id])).toEqual([
			['cloze', 'e1'],
			['order', 'e2'],
			['cloze', 'e3']
		]);
		const cloze = first[0];
		expect(cloze.kind === 'cloze' && [...cloze.choices].sort()).toEqual(['在', '很', '是'].sort());
	});

	it('moves on to other examples at the next review', () => {
		expect(reviewExercises(six, 1).map((e) => e.example.id)).toEqual(['e4', 'e5', 'e6']);
	});

	it('takes word order when a cloze cannot be built, and skips an example that is neither', () => {
		const odd = lesson([example('a', { focus: '' }), example('b', { focus: '', noOrder: true }), example('c', { distractors: ['很'] })]);
		expect(reviewExercises(odd, 0).map((e) => [e.kind, e.example.id])).toEqual([
			['order', 'a'],
			['order', 'c']
		]);
	});

	it('shuffles the cloze choices the same way for the same review', () => {
		const a = reviewExercises(six, 2);
		const b = reviewExercises(six, 2);
		expect(a).toEqual(b);
	});
});

describe('pointStatus', () => {
	it('is null for a point that is not learned', () => {
		expect(pointStatus(undefined, NOW)).toBeNull();
	});
	it('says due, the due instant and the last review', () => {
		const state = { point: 'p:one', learnedAt: '2026-11-20T08:00:00Z', reviews: 2, lastReviewed: '2026-11-25T08:00:00Z', firstReviewAt: 0, due: '2026-11-27T09:00:00Z', stability: 1, difficulty: 5, state: 2 };
		expect(pointStatus(state, NOW)).toEqual({ due: true, dueAt: '2026-11-27T09:00:00Z', lastReviewed: '2026-11-25T08:00:00Z', learnedAt: '2026-11-20T08:00:00Z' });
		expect(pointStatus({ ...state, due: '2026-11-30T09:00:00Z' }, NOW)?.due).toBe(false);
	});
});

describe('loadReview', () => {
	it('derives each learned point and the round over the installed lessons of the workspace language', async () => {
		loadStudyHistory.mockResolvedValue(
			history([
				{ id: 'a', ts: '2026-11-19T08:00:00Z', payload: grammarPayload('p', 'one', 4, 4) },
				{ id: 'b', ts: '2026-11-19T08:00:00Z', payload: grammarPayload('p', 'two', 1, 4) },
				{ id: 'c', ts: '2026-11-19T09:00:00Z', payload: grammarPayload('gone', 'x', 4, 4) }
			])
		);
		listGrammar.mockResolvedValue([pack('p', ['one', 'two'])]);
		const s = session();
		const data = await loadReview(s as never, { id: 7, language: 'zh' } as never, NOW);
		expect(listGrammar).toHaveBeenCalledWith('zh');
		expect([...data.states.keys()].sort()).toEqual(['gone:x', 'p:one']);
		expect(data.round.items).toEqual([{ point: 'p:one', why: 'new' }]);
		expect(data.progress.get('p:two')).toMatchObject({ best: 1, total: 4 });
		expect(data.titles.get('p:one')).toBe('one');
	});
});

describe('recording a review', () => {
	it('reviewEvent is a grammar event with mode review', () => {
		const event = reviewEvent(7, 'p', 'one', 2, 3, NOW);
		expect(event).toMatchObject({ workspaceId: 7, device: 'web', ts: '2026-11-27T10:00:00.250Z', type: 'grammar' });
		expect(JSON.stringify(event.payload)).toBe('{"point":"p:one","mode":"review","score":2,"total":3}');
	});

	it('recordReview goes through the outbox and throws when the run was not kept', async () => {
		const s = session();
		const run = await recordReview(s, 7, 'p', 'one', 3, 3, NOW);
		expect(s.outbox.recordEvent).toHaveBeenCalledTimes(1);
		expect(run).toMatchObject({ point: 'p:one', mode: 'review', score: 3, total: 3, workspaceId: 7 });
		await expect(recordReview(session(() => null), 7, 'p', 'one', 3, 3, NOW)).rejects.toThrow();
	});
});
