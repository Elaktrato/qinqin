import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scheme } from '$lib/api/types';
import {
	MASTERY_MAP_KEY,
	gradingOptions,
	includeOutsidePatch,
	gradingPatch,
	readMasteryMap,
	resolveGrading,
	studyLevelsPatch,
	studySet
} from './mapGrading';

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/settings/mastery-map.json'), 'utf8')
) as {
	rule: string;
	key: string;
	builtIn: Record<string, string[]>;
	parse: { name: string; settings: Record<string, unknown> | null; expect: unknown }[];
	resolve: { name: string; language: string; installed: string[]; settings: Record<string, unknown>; expect: string | null }[];
	studySet: { name: string; pack: string; ords: number[]; settings: Record<string, unknown>; expect: number[] }[];
	patch: {
		name: string;
		set: { grading?: string; includeOutside?: boolean; pack?: string; levels?: number[]; ords?: number[] };
		expect: unknown;
	}[];
};

/** A scheme row of GET /api/schemes for a pack id (its language from the id: hsk/tgh are zh, the rest ja). */
function scheme(packId: string, index: number): Scheme {
	const language = /^(hsk|tgh)/.test(packId) ? 'zh' : 'ja';
	return { id: index + 1, name: packId, unit: 'character', language, packId, levels: [{ id: 100 + index, ord: 0, name: 'L' }] };
}

describe('docs/contracts/settings/mastery-map.json', () => {
	it('names the rule and the key', () => {
		expect(fixture.rule).toBe('settings/mastery-map');
		expect(fixture.key).toBe(MASTERY_MAP_KEY);
	});

	it('offers the built-in groupings of the language first, then its packs', () => {
		for (const [language, keys] of Object.entries(fixture.builtIn)) {
			expect(gradingOptions(language, []).map((o) => o.value)).toEqual(keys);
		}
		const values = gradingOptions('zh', ['hsk-chars', 'hsk-mini', 'jlpt-kanji'].map(scheme)).map((o) => o.value);
		expect(values).toEqual([...fixture.builtIn.zh, 'pack:hsk-chars']);
	});

	it.each(fixture.parse)('parse: $name', ({ settings, expect: want }) => {
		expect(readMasteryMap(settings)).toEqual(want);
	});

	it.each(fixture.resolve)('resolve: $name', ({ language, installed, settings, expect: want }) => {
		expect(resolveGrading(language, installed.map(scheme), readMasteryMap(settings))).toBe(want);
	});

	it.each(fixture.studySet)('study set: $name', ({ pack, ords, settings, expect: want }) => {
		expect(studySet(pack, ords, readMasteryMap(settings))).toEqual(want);
	});

	it.each(fixture.patch)('patch: $name', ({ set, expect: want }) => {
		const patch =
			set.grading !== undefined
				? gradingPatch(set.grading)
				: set.includeOutside !== undefined
					? includeOutsidePatch(set.includeOutside)
					: studyLevelsPatch(set.pack!, set.levels!, set.ords!);
		expect(patch).toEqual(want);
	});
});
