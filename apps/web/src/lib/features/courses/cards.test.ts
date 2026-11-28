import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { newSession, studyContext, type TestContext } from '$lib/testing/context';
import { StudyServer } from '$lib/testing/studyServer';
import { cardRow, type CardRow, type DeckRow } from '$lib/studycore/rows';
import { getStudyData } from '$lib/studycore/data';
import * as build from '$lib/testing/study';
import { addCourseCards, courseDeckId, markCourseKnown, planCourseCards, recordFirstReviews } from './cards';
import { testCourse } from './testing/course';

const WS = 7;
let ctx: TestContext = studyContext();
let server: StudyServer;
const course = testCourse();
const meta = { workspaceId: WS, version: 1, updatedAt: '2026-01-01T00:00:00Z', deletedAt: null };

beforeEach(() => {
	ctx = studyContext();
	newSession(ctx);
	server = new StudyServer({ now: () => Date.now() });
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal('fetch', vi.fn(server.fetch));
});
afterEach(() => {
	newSession(ctx);
	vi.unstubAllGlobals();
});

describe('course cards (#222, Rulings 16–18)', () => {
	it('courseDeckId: d-course- and the course id in lower case, other characters dashed', () => {
		expect(courseDeckId('zh-test')).toBe('d-course-zh-test');
		expect(courseDeckId('My.Course_1')).toBe('d-course-my-course-1');
	});

	it('planCourseCards: the deck when missing, a vocab card per word without one; a carded word is left alone', () => {
		const existing = build.card({ id: 'c-vocab-102', entryId: 102, deckIds: ['general'] });
		const plan = planCourseCards({ decks: [], cards: [existing] }, undefined, course, [
			{ entryId: 101, form: '你好' },
			{ entryId: 102, form: '谢谢' }
		], new Date('2026-11-28T09:00:00Z'));
		expect(plan.writes.map((w) => w.collection)).toEqual(['decks', 'cards']);
		expect(plan.writes[0].row).toMatchObject({ id: 'd-course-zh-test', name: 'Test course' });
		expect(plan.created).toEqual([
			{ id: 'c-vocab-101', kind: 'vocab', entryId: 101, written: '你好', deckIds: ['d-course-zh-test'], createdAt: '2026-11-28T09:00:00.000Z' }
		]);
		const again = planCourseCards({ decks: [{ id: 'd-course-zh-test', name: 'x', createdAt: '' }], cards: [existing, ...plan.created] }, undefined, course, [{ entryId: 101, form: '你好' }], new Date());
		expect(again.writes).toEqual([]);
		expect(again.created).toEqual([]);
	});

	it('addCourseCards writes the deck and the cards to the workspace and answers the new cards', async () => {
		server.putTyped('cards', { ...cardRow(build.card({ id: 'c-vocab-102', entryId: 102 })), ...meta });
		await getStudyData(ctx.session.study, WS);
		const created = await addCourseCards(ctx.session.study, WS, course, [
			{ entryId: 101, form: '你好' },
			{ entryId: 102, form: '谢谢' }
		]);
		expect(created.map((c) => c.id)).toEqual(['c-vocab-101']);
		expect((server.typedRows('decks', WS) as DeckRow[]).map((d) => d.id)).toEqual(['d-course-zh-test']);
		expect((server.typedRows('cards', WS) as CardRow[]).map((c) => [c.id, c.deckIds])).toEqual([
			['c-vocab-102', ['general']],
			['c-vocab-101', ['d-course-zh-test']]
		]);
	});

	it('markCourseKnown marks the entries of the keys as one placement declaration', async () => {
		await getStudyData(ctx.session.study, WS);
		await markCourseKnown(ctx.session.study, WS, course, ['你好', '学习', 'not-a-word']);
		const data = await getStudyData(ctx.session.study, WS);
		expect([...(data.known ?? [])].sort()).toEqual([101, 103]);
		expect(new Set(data.knownDeclared?.map((d) => d.batch.source))).toEqual(new Set(['placement']));
		expect(data.knownDeclared?.[0].batch.scope).toBe('Course: Test course');
	});

	it('recordFirstReviews records one vocab review per new card with its grade (Good without one)', async () => {
		const reviews: unknown[][] = [];
		const outbox = { recordReview: async (...args: unknown[]) => (reviews.push(args), null) };
		const cards = [build.card({ id: 'c-vocab-101', entryId: 101 }), build.card({ id: 'c-vocab-103', entryId: 103 })];
		await recordFirstReviews({ outbox } as never, WS, cards, new Map([[101, 2]]));
		expect(reviews).toEqual([
			[WS, 'c-vocab-101', 2, 'vocab'],
			[WS, 'c-vocab-103', 3, 'vocab']
		]);
	});
});
