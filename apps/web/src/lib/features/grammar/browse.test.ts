import { describe, expect, it } from 'vitest';
import { browseSections } from './browse';
import type { PackInfo, Progress } from './types';

const pack: PackInfo = {
	packId: 'p',
	name: 'Pack',
	version: '1',
	language: 'zh',
	license: 'CC0-1.0',
	attribution: 'me',
	notice: '',
	levels: [
		{ id: 'l1', name: 'Part 1', schemeLevels: [{ scheme: 'hsk-words', level: 'HSK 1' }] },
		{ id: 'l2', name: 'Part 2', schemeLevels: [] }
	],
	lessons: [
		{ id: 'a', level: 'l1', title: 'A', summary: '', examples: 4 },
		{ id: 'b', level: 'l2', title: 'B', summary: '', examples: 4 }
	]
};
const done: Progress = { completedAt: '2026-01-01T00:00:00Z', best: 3, total: 8 };

describe('browseSections', () => {
	// Ruling (#198): every installed pack shows; the pack's old plugin state is not read.
	it('shows every installed pack', () => {
		expect(browseSections([pack], [], new Map()).map((s) => s.packId)).toEqual([pack.packId]);
	});
	it('shows no sections for no packs', () => {
		expect(browseSections([], [], new Map())).toEqual([]);
	});
	it('attaches progress and drops orphan rows', () => {
		const progress = new Map([
			['p:a', done],
			['p:gone', done]
		]);
		const [section] = browseSections([pack], [], progress);
		expect(section.levels[0].lessons[0].progress).toEqual(done);
		expect(section.levels[1].lessons[0].progress).toBeNull();
		expect(section.levels.flatMap((l) => l.lessons)).toHaveLength(2);
	});
	it('shows a badge only when the scheme pack and level exist', () => {
		const without = browseSections([pack], [], new Map())[0];
		expect(without.levels[0].badges).toEqual([]);
		const wrongLevel = browseSections(
			[pack],
			[{ packId: 'hsk-words', levels: [{ name: 'HSK 2' }] }],
			new Map()
		)[0];
		expect(wrongLevel.levels[0].badges).toEqual([]);
		const withScheme = browseSections(
			[pack],
			[{ packId: 'hsk-words', levels: [{ name: 'HSK 1' }] }],
			new Map()
		)[0];
		expect(withScheme.levels[0].badges).toEqual(['≈ HSK 1']);
		expect(withScheme.levels[1].badges).toEqual([]);
	});
	it('keeps credits and omits empty levels', () => {
		const p = { ...pack, lessons: [pack.lessons![0]] };
		const [section] = browseSections([p], [], new Map());
		expect(section.levels.map((l) => l.id)).toEqual(['l1']);
		expect(section.credits).toEqual({ license: 'CC0-1.0', attribution: 'me', version: '1' });
	});
	it('groups a full seven-level pack of 350 lessons', () => {
		const names = ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6', 'HSK 7–9'];
		const full: PackInfo = {
			...pack,
			packId: 'zh-grammar',
			levels: names.map((name, i) => ({
				id: `hsk-${i + 1}`,
				name: `Level ${i + 1}`,
				schemeLevels: [{ scheme: 'hsk-words', level: name }]
			})),
			lessons: names.flatMap((_, i) =>
				Array.from({ length: 50 }, (_, j) => ({
					id: `l${i + 1}-${j}`,
					level: `hsk-${i + 1}`,
					title: `Lesson ${j}`,
					summary: '',
					examples: 5
				}))
			)
		};
		const scheme = [{ packId: 'hsk-words', levels: names.map((name) => ({ name })) }];
		const [section] = browseSections([full], scheme, new Map());
		expect(section.levels).toHaveLength(7);
		expect(section.levels.flatMap((l) => l.lessons)).toHaveLength(350);
		expect(section.levels[0].badges).toEqual(['≈ HSK 1']);
		expect(section.levels[6].badges).toEqual(['≈ HSK 7–9']);
	});
});
