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
	it('hides a disabled pack', () => {
		expect(browseSections([pack], [], () => false, new Map())).toEqual([]);
	});
	it('shows no sections for no packs', () => {
		expect(browseSections([], [], () => true, new Map())).toEqual([]);
	});
	it('attaches progress and drops orphan rows', () => {
		const progress = new Map([
			['lesson:p:a', done],
			['lesson:p:gone', done]
		]);
		const [section] = browseSections([pack], [], () => true, progress);
		expect(section.levels[0].lessons[0].progress).toEqual(done);
		expect(section.levels[1].lessons[0].progress).toBeNull();
		expect(section.levels.flatMap((l) => l.lessons)).toHaveLength(2);
	});
	it('shows a badge only when the scheme pack and level exist', () => {
		const without = browseSections([pack], [], () => true, new Map())[0];
		expect(without.levels[0].badges).toEqual([]);
		const wrongLevel = browseSections(
			[pack],
			[{ packId: 'hsk-words', levels: [{ name: 'HSK 2' }] }],
			() => true,
			new Map()
		)[0];
		expect(wrongLevel.levels[0].badges).toEqual([]);
		const withScheme = browseSections(
			[pack],
			[{ packId: 'hsk-words', levels: [{ name: 'HSK 1' }] }],
			() => true,
			new Map()
		)[0];
		expect(withScheme.levels[0].badges).toEqual(['≈ HSK 1']);
		expect(withScheme.levels[1].badges).toEqual([]);
	});
	it('keeps credits and omits empty levels', () => {
		const p = { ...pack, lessons: [pack.lessons![0]] };
		const [section] = browseSections([p], [], () => true, new Map());
		expect(section.levels.map((l) => l.id)).toEqual(['l1']);
		expect(section.credits).toEqual({ license: 'CC0-1.0', attribution: 'me', version: '1' });
	});
});
