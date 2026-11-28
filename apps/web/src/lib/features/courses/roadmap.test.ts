import { describe, expect, it } from 'vitest';
import type { StudyEvent } from '$lib/events';
import { courseState } from './progress';
import { MILESTONE_WORDS, lessonLabel, roadmap, titleText } from './roadmap';
import { testCourse } from './testing/course';

const course = testCourse();
let n = 0;
function ev(payload: Record<string, unknown>): StudyEvent {
	n += 1;
	return { id: `e${String(n).padStart(3, '0')}`, workspaceId: 7, device: 'web', ts: `2026-11-28T08:${String(n).padStart(2, '0')}:00Z`, type: 'course', payload: { course: 'zh-test', ...payload } };
}
const finished = (unit: string, lesson: string, words: string[] = []) => ev({ kind: 'lesson-finished', unit, lesson, score: 1, total: 1, words });
const map = (events: StudyEvent[], known: number[] = []) => roadmap(course, courseState(course, { courseEvents: events, known }));

describe('the roadmap model (#222)', () => {
	it('a fresh learner: the first unit is current with its first lesson next, the rest locked', () => {
		const r = map([]);
		expect(r.sections.map((s) => [s.id, s.status])).toEqual([
			['start', 'current'],
			['level-1', 'locked'],
			['level-2', 'locked']
		]);
		const sounds = r.sections[0].units[0];
		expect(sounds).toMatchObject({ id: 'sounds', title: 'sounds', status: 'current', current: true });
		expect(sounds.lessons).toEqual([
			{ id: 'listening', kind: 'listening', label: 'Listening', status: 'next', started: false, href: '/courses/play/zh-test/sounds/listening' }
		]);
		expect(r.next).toEqual({ href: '/courses/play/zh-test/sounds/listening', label: 'Listening', unit: 'sounds' });
		expect(r.met).toBe(0);
		expect(r.total).toBe(5);
	});

	it('locked units offer the unit test (skip ahead); a unit without a test does not', () => {
		const r = map([]);
		const hello = r.sections[1].units[0];
		expect(hello.status).toBe('locked');
		expect(hello.test).toBe('/courses/play/zh-test/hello/test');
		expect(r.sections[0].units[0].test).toBeNull();
		expect(hello.lessons.every((l) => l.status === 'locked' && l.href === null)).toBe(true);
	});

	it('the section exam shows on a section with an exam that is not done; the start section has none', () => {
		const r = map([]);
		expect(r.sections[0].exam).toBeNull();
		expect(r.sections[1].exam).toBe('/courses/play/zh-test/section/level-1/exam');
	});

	it('when every lesson of the current unit is done, its next step is the unit test', () => {
		const events = [finished('sounds', 'listening'), finished('hello', 'script'), finished('hello', 'words-1', ['你好', '谢谢']), finished('hello', 'grammar-shi'), finished('hello', 'practice'), finished('hello', 'reading')];
		const r = map(events);
		const hello = r.sections[1].units[0];
		expect(hello.status).toBe('current');
		expect(hello.next).toBe('test');
		expect(r.next).toEqual({ href: '/courses/play/zh-test/hello/test', label: 'Take the unit test', unit: 'hello' });
		expect(r.met).toBe(2);
	});

	it('lesson labels name the kind, word lessons their number', () => {
		const hello = map([]).sections[1].units[0];
		expect(hello.lessons.map((l) => l.label)).toEqual(['Script', 'New words 1', 'Grammar', 'Practice', 'Reading']);
		expect(lessonLabel({ id: 'catch-up-2', kind: 'words' })).toBe('Catch-up 2');
		expect(lessonLabel({ id: 'speaking', kind: 'speaking' })).toBe('Speaking');
	});

	it('a skipped unit is done, skipped, and offers "Add these as cards" for its words not yet carded', () => {
		const r = map([ev({ kind: 'placement', section: 'level-2' })]);
		const hello = r.sections[1].units[0];
		expect(hello).toMatchObject({ status: 'done', skipped: true });
		expect(hello.skippedWords).toEqual(['你好', '谢谢']);
		expect(r.sections[1].units[1].skippedWords).toEqual(['学习']);
		expect(r.sections[2].units[0]).toMatchObject({ status: 'current', skippedWords: [] });
	});

	it('a done, studied unit with words added later shows its catch-up lessons as open', () => {
		const events = [
			finished('sounds', 'listening'),
			finished('hello', 'words-1', ['你好']),
			ev({ kind: 'unit-test', unit: 'hello', score: 9, total: 10, passed: true, early: false })
		];
		const hello = map(events).sections[1].units[0];
		expect(hello.status).toBe('done');
		expect(hello.catchUp).toEqual([
			{ id: 'catch-up-1', kind: 'words', label: 'Catch-up 1', status: 'next', started: false, href: '/courses/play/zh-test/hello/catch-up-1' }
		]);
	});

	it('milestones: the word marks placed after the unit that reaches them, reached when met', () => {
		expect(MILESTONE_WORDS).toEqual([50, 100, 250, 500, 1000, 1500, 2000, 3000]);
		const big = testCourse();
		const unit = big.sections[1].units[0];
		unit.words = Array.from({ length: 60 }, (_, i) => ({ key: `w${i}`, form: `w${i}`, reading: '', entryId: 1000 + i, rank: null, topics: [] }));
		const r = roadmap(big, courseState(big, { courseEvents: [], known: [] }));
		expect(r.sections[1].units[0].milestones).toEqual([{ words: 50, reached: false }]);
		expect(r.sections[1].units[1].milestones).toEqual([]);
	});

	it('titleText picks the interface language, else English', () => {
		expect(titleText({ en: 'Hello', de: 'Hallo' }, 'de')).toBe('Hallo');
		expect(titleText({ en: 'Hello' }, 'ja')).toBe('Hello');
	});
});
