import { describe, expect, it } from 'vitest';
import type { SenseGroup, SenseView } from '$lib/api/types';
import { dictionaryGroups, entrySenses, pageGroups, shownGlosses, unitsOf } from './entrySenses';

function group(dictionaryId: number, glosses: string[], extra: Partial<SenseGroup> = {}): SenseGroup {
	return {
		dictionaryId,
		dictionaryName: `Dict ${dictionaryId}`,
		packId: `d${dictionaryId}`,
		license: 'CC-BY-SA-4.0',
		attribution: `Credit ${dictionaryId}`,
		pos: [],
		tags: [],
		glosses,
		xrefs: [],
		...extra
	};
}

function flat(groups: SenseGroup[]): SenseView[] {
	return groups.flatMap((g) =>
		g.glosses.map((gloss) => ({
			dictionaryId: g.dictionaryId,
			dictionaryName: g.dictionaryName,
			packId: g.packId,
			license: g.license,
			attribution: g.attribution,
			gloss
		}))
	);
}

// 鸡 as CC-CEDICT gives it: the slang gloss of the everyday line.
const ji = [group(1, ['fowl', 'chicken', '(slang) prostitute']), group(1, ['variant of 雞|鸡[ji1]'])];

describe('entrySenses', () => {
	it('takes the sense groups when the answer has them', () => {
		expect(entrySenses({ senses: flat(ji), senseGroups: ji })).toEqual(ji);
	});

	it('falls back to one sense per flat gloss for an answer without groups', () => {
		const senses = entrySenses({ senses: flat(ji) });
		expect(senses.map((s) => s.glosses)).toEqual([['fowl'], ['chicken'], ['(slang) prostitute'], ['variant of 雞|鸡[ji1]']]);
		expect(senses[0]).toMatchObject({ dictionaryName: 'Dict 1', license: 'CC-BY-SA-4.0', tags: [], pos: [] });
	});
});

describe('unitsOf', () => {
	it('keeps each unit with its sense, xrefs on the first unit of a sense only', () => {
		const senses = [group(1, ['dog', 'prostitute'], { xrefs: ['犬・1'] })];
		const units = unitsOf(senses);
		expect(units.map((u) => [u.glosses, u.folded, u.firstOfSense])).toEqual([
			[['dog'], false, true],
			[['prostitute'], true, false]
		]);
		expect(units[1].of).toBe(senses[0]);
	});
});

describe('shownGlosses', () => {
	it('lists unfolded glosses in display order, at most max', () => {
		expect(shownGlosses(unitsOf(ji), 3)).toEqual(['fowl', 'chicken', 'variant of 雞|鸡[ji1]']);
		expect(shownGlosses(unitsOf(ji), 1)).toEqual(['fowl']);
	});

	it('shows a vulgar-only entry', () => {
		expect(shownGlosses(unitsOf([group(1, ['penis (vulgar)'])]), 3)).toEqual(['penis (vulgar)']);
	});
});

describe('dictionaryGroups', () => {
	it('groups units by dictionary in first-seen display order', () => {
		const senses = [group(1, ['(slang) prostitute']), group(2, ['hen']), group(1, ['fowl'])];
		const groups = dictionaryGroups(unitsOf(senses));
		expect(groups.map((g) => [g.dictionaryId, g.units.map((u) => u.glosses[0])])).toEqual([
			[2, ['hen']],
			[1, ['fowl', '(slang) prostitute']]
		]);
		expect(groups[1]).toMatchObject({ dictionaryName: 'Dict 1', license: 'CC-BY-SA-4.0', attribution: 'Credit 1' });
	});
});

describe('pageGroups', () => {
	const senses = [group(1, ['fowl', '(slang) prostitute']), group(2, ['hen', 'cock'])];

	it('keeps every unit, sensitive ones last in their dictionary and unfolded', () => {
		const page = pageGroups(senses, new Set(), false);
		expect(page.groups.map((g) => g.units.map((u) => [u.glosses, u.mark]))).toEqual([
			[
				[['fowl'], null],
				[['(slang) prostitute'], 'vulg']
			],
			[[['hen', 'cock'], null]]
		]);
		expect(page).toMatchObject({ hiddenCount: 0, allHidden: false });
	});

	it('leaves hidden dictionaries out until revealed and counts their glosses', () => {
		expect(pageGroups(senses, new Set([2]), false)).toMatchObject({ hiddenCount: 2, allHidden: false });
		expect(pageGroups(senses, new Set([2]), false).groups.map((g) => g.dictionaryId)).toEqual([1]);
		expect(pageGroups(senses, new Set([2]), true).groups.map((g) => g.dictionaryId)).toEqual([1, 2]);
	});

	it('shows everything when every dictionary is hidden', () => {
		const page = pageGroups(senses, new Set([1, 2]), false);
		expect(page.allHidden).toBe(true);
		expect(page.groups).toHaveLength(2);
	});
});
