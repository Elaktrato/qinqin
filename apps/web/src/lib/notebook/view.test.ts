import { describe, expect, it } from 'vitest';

import type { Course } from '$lib/api/courses';
import type { DrillDef, DrillItem } from '$lib/features/practice/types';
import type { NotebookItem } from '$lib/studycore/notebook';
import type { StudyCard } from '$lib/studycore/types';
import { drillsNamed, linkedItems, notebookCardIds, notebookSections, parseNotebookRoute, practiseRound, rowOf, type NotebookContext } from './view';

const card: StudyCard = { id: 'c-vocab-1', kind: 'vocab', entryId: 1, written: '学习', deckIds: ['general'], createdAt: '2026-11-01T00:00:00Z' };
const drill = { id: 'tone-pairs', title: 'Tone pairs', label: (item: DrillItem) => `pair ${item.key}` } as unknown as DrillDef;

function item(key: string, group: NotebookItem['group'], ref: NotebookItem['ref'], wrong: NotebookItem['wrong'] = {}, right = 0): NotebookItem {
	return { key, group, since: '2026-11-20T10:00:00Z', last: '2026-11-20T10:00:00Z', mistakes: 2, right, ref, wrong };
}

const cardItem = item('card:c-vocab-1', 'words', { source: 'card', cardId: 'c-vocab-1', entryId: 1, kind: 'vocab' }, { mode: 'vocab', grade: 1 }, 1);
const drillItem = item('drill.tone-pairs:3-4', 'tones', { source: 'drill', drill: 'tone-pairs', item: '3-4' }, { mode: 'choose', grade: 1 });
const otherDrill = item('drill.counters:9', 'words', { source: 'drill', drill: 'counters', item: '9' }, { mode: 'choose', grade: 1 });
const gone = item('drill.tone-pairs:5-5', 'tones', { source: 'drill', drill: 'tone-pairs', item: '5-5' }, { mode: 'choose', grade: 1 });
const grammarItem = item('grammar:hsk1:shi', 'grammar', { source: 'grammar', point: 'hsk1:shi' }, { mode: 'lesson', score: 6, total: 10 });
const unitItem = item('course:zh:unit:u1', 'course', { source: 'course', course: 'zh', check: 'unit', unit: 'u1' }, { score: 5, total: 10 });
const lessonItem = item('course:zh:lesson:u1:words-2', 'course', { source: 'course', course: 'zh', check: 'lesson', unit: 'u1', lesson: 'words-2' }, { score: 2, total: 5 });
const examItem = item('course:zh:section:s9', 'course', { source: 'course', course: 'zh', check: 'section', section: 's9' }, { score: 1, total: 20 });

const course = { id: 'zh', title: { en: 'Chinese path' }, sections: [{ id: 's1', title: { en: 'Start' }, units: [{ id: 'u1', title: { en: 'Hello' } }] }] } as unknown as Course;

const ctx: NotebookContext = {
	cards: new Map([[card.id, card]]),
	drills: new Map([[drill.id, drill]]),
	drillItems: new Map([['tone-pairs', new Map([['3-4', { key: '3-4' }]])]]),
	grammarTitles: new Map([['hsk1:shi', '是 (to be)']]),
	courses: new Map([['zh', course]]),
	language: 'en'
};

describe('the notebook view', () => {
	it('routes /notebook and /notebook/practise', () => {
		expect(parseNotebookRoute('')).toEqual({ view: 'list' });
		expect(parseNotebookRoute('practise')).toEqual({ view: 'practise' });
		expect(parseNotebookRoute('practise/x')).toEqual({ view: 'list' });
	});

	it('words a card item: its word, its card type, Again, the count and the run', () => {
		const row = rowOf(cardItem, ctx);
		expect(row).toMatchObject({ title: '学习', inStudyLanguage: true, source: 'Card: Recognise', wrong: 'Answered Again', mistakes: '2 mistakes', href: '/entry/1' });
		expect(row.progress).toBe('1 of 3 right in a row');
		expect(row.last).toMatch(/^Last mistake /);
	});

	it('words a drill item with its drill label and links the drill; another language links nothing', () => {
		expect(rowOf(drillItem, ctx)).toMatchObject({ title: 'pair 3-4', source: 'Tone pairs', wrong: 'Answered wrong', href: '/practice/tone-pairs', progress: null });
		expect(rowOf(otherDrill, ctx)).toMatchObject({ title: '9', source: 'counters', href: null });
	});

	it('words grammar and course items with their titles, falling back to ids', () => {
		expect(rowOf(grammarItem, ctx)).toMatchObject({ title: '是 (to be)', inStudyLanguage: false, wrong: '6 of 10 right', href: '/grammar/hsk1/shi' });
		expect(rowOf(unitItem, ctx)).toMatchObject({ title: 'Unit test: Hello', source: 'Chinese path', wrong: 'Not passed: 5 of 10 right', href: '/courses/play/zh/u1/test' });
		expect(rowOf(lessonItem, ctx)).toMatchObject({ title: 'Hello: New words 2', wrong: '2 of 5 right', href: '/courses/play/zh/u1/words-2' });
		expect(rowOf(examItem, ctx)).toMatchObject({ title: 'Exam: s9', href: '/courses/play/zh/section/s9/exam' });
	});

	it('groups the items in the notebook order and leaves out empty groups', () => {
		const sections = notebookSections([cardItem, drillItem, grammarItem, unitItem], ctx);
		expect(sections.map((s) => [s.group, s.title, s.rows.length])).toEqual([
			['words', 'Words', 1],
			['tones', 'Tones', 1],
			['grammar', 'Grammar', 1],
			['course', 'Course lessons and tests', 1]
		]);
	});

	it('the round asks the drill items a drill of this language can ask now', () => {
		const items = [cardItem, drillItem, otherDrill, gone, grammarItem];
		expect(practiseRound(items, ctx)).toEqual([{ drill: 'tone-pairs', item: { key: '3-4' } }]);
		expect(drillsNamed(items)).toEqual(['tone-pairs', 'counters']);
		expect(notebookCardIds(items)).toEqual(['c-vocab-1']);
		expect(linkedItems([cardItem, grammarItem, unitItem]).map((i) => i.key)).toEqual(['grammar:hsk1:shi', 'course:zh:unit:u1']);
	});

	it('the round holds at most 20 items', () => {
		const many = Array.from({ length: 25 }, (_, i) => item(`drill.tone-pairs:${i}`, 'tones', { source: 'drill', drill: 'tone-pairs', item: String(i) }));
		const all: NotebookContext = { ...ctx, drillItems: new Map([['tone-pairs', new Map(many.map((_, i) => [String(i), { key: String(i) }]))]]) };
		expect(practiseRound(many, all)).toHaveLength(20);
	});
});
