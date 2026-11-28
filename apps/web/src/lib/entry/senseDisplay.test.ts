import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/senses/display.json';
import {
	EXPLICIT_WORDS,
	MINOR_PREFIXES,
	MINOR_TAGS,
	VULGAR_CHARACTERS,
	displayGloss,
	displaySenses,
	type SenseUnit
} from './senseDisplay';

describe('displaySenses (senses/display.json)', () => {
	it('is the sense display rule', () => {
		expect(fixture.rule).toBe('senses/display');
		expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
		expect([...EXPLICIT_WORDS]).toEqual(fixture.explicitWords);
		expect([...VULGAR_CHARACTERS]).toEqual(fixture.vulgarCharacters);
		expect([...MINOR_PREFIXES]).toEqual(fixture.minorPrefixes);
		expect([...MINOR_TAGS]).toEqual(fixture.minorTags);
	});

	it.each(fixture.cases)('$name', (c) => {
		const pinned = 'pinned' in c ? (c.pinned as string) : undefined;
		expect(displaySenses(c.senses, pinned)).toEqual(c.units as SenseUnit[]);
		expect(displayGloss(c.senses, pinned)).toBe(c.gloss);
	});

	it('reads missing tags as none', () => {
		expect(displaySenses([{ glosses: ['(slang) prostitute'] }, { glosses: ['chicken'] }])).toEqual([
			{ sense: 1, class: 'everyday', mark: null, folded: false, glosses: ['chicken'] },
			{ sense: 0, class: 'sensitive', mark: 'vulg', folded: true, glosses: ['(slang) prostitute'] }
		]);
	});
});
