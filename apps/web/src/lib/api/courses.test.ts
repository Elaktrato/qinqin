import { describe, expect, it } from 'vitest';

import fillFixture from '../../../../../docs/contracts/courses/fill.json';
import { decodeCourse, decodeCourseList } from './courses';

interface FillCase {
	name: string;
	expect: Record<string, unknown>;
}
const fixture = fillFixture as unknown as { rule: string; cases: FillCase[] };

const META = { id: 'zh-test', name: 'Test course', version: '1', license: 'CC-BY-4.0', attribution: 'Testers', notice: '', fill: '0123456789abcdef' };

describe('docs/contracts/courses/fill.json', () => {
	it('is the fill rule', () => {
		expect(fixture.rule).toBe('courses/fill');
		expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
	});

	for (const c of fixture.cases) {
		it(`decodes: ${c.name}`, () => {
			const body = { ...META, ...c.expect };
			const course = decodeCourse(body);
			expect(course).not.toBeNull();
			// The decoder keeps every member the server sends, unchanged.
			expect(course).toEqual(body);
		});
	}
});

describe('decodeCourse', () => {
	const good = (): Record<string, unknown> => structuredClone({ ...META, ...fixture.cases[0]!.expect });
	const sectionsOf = (b: Record<string, unknown>) => b.sections as Record<string, unknown>[];
	const unitsOf = (b: Record<string, unknown>) => sectionsOf(b)[1]!.units as Record<string, unknown>[];

	it('refuses a body that is not a course', () => {
		expect(decodeCourse(null)).toBeNull();
		expect(decodeCourse([])).toBeNull();
		expect(decodeCourse({ ...good(), sections: 'none' })).toBeNull();
		expect(decodeCourse({ ...good(), fill: 7 })).toBeNull();
	});

	it('refuses a unit with a malformed word or lesson', () => {
		const b = good();
		(unitsOf(b)[0]!.words as Record<string, unknown>[])[0]!.entryId = 'x';
		expect(decodeCourse(b)).toBeNull();
		const c = good();
		(unitsOf(c)[0]!.lessons as Record<string, unknown>[])[1]!.words = 'a';
		expect(decodeCourse(c)).toBeNull();
	});

	it('skips a lesson of a kind it does not know, keeping the rest', () => {
		const b = good();
		const lessons = unitsOf(b)[0]!.lessons as Record<string, unknown>[];
		lessons.splice(1, 0, { id: 'drill', kind: 'drill' });
		const course = decodeCourse(b);
		expect(course?.sections[1]!.units[0]!.lessons.map((l) => l.id)).toEqual(['script', 'words-1', 'grammar-a', 'practice', 'reading']);
	});

	it('decodes the course list', () => {
		const list = { courses: [{ id: 'zh-test', name: 'N', version: '1', language: 'zh', license: 'CC-BY-4.0', attribution: 'A', notice: '', title: { en: 'T' } }] };
		expect(decodeCourseList(list)).toEqual(list.courses);
		expect(decodeCourseList({ courses: [{ id: 3 }] })).toEqual([]);
		expect(decodeCourseList(null)).toEqual([]);
	});
});
