import { describe, expect, it } from 'vitest';
import { parsePracticeRoute, practiceHref } from './route';

describe('parsePracticeRoute', () => {
	it('is the list by default', () => {
		expect(parsePracticeRoute('', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('/', ['tone-pairs'])).toEqual({ view: 'list' });
	});

	it('is a drill round for a drill that applies, and the weakest round', () => {
		expect(parsePracticeRoute('tone-pairs', ['tone-pairs'])).toEqual({ view: 'drill', drill: 'tone-pairs' });
		expect(parsePracticeRoute('/tone-pairs/', ['tone-pairs'])).toEqual({ view: 'drill', drill: 'tone-pairs' });
		expect(parsePracticeRoute('weakest', [])).toEqual({ view: 'weakest' });
	});

	it("is a drill's own weakest round", () => {
		expect(parsePracticeRoute('tone-pairs/weakest', ['tone-pairs'])).toEqual({ view: 'drillWeakest', drill: 'tone-pairs' });
		expect(parsePracticeRoute('/tone-pairs/weakest/', ['tone-pairs'])).toEqual({ view: 'drillWeakest', drill: 'tone-pairs' });
	});

	it('falls back to the list for a drill that does not apply or a longer path', () => {
		expect(parsePracticeRoute('counters', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('counters/weakest', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('tone-pairs/extra', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('tone-pairs/weakest/x', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('weakest/x', [])).toEqual({ view: 'list' });
	});

	it('builds the hrefs it parses', () => {
		expect(practiceHref({ view: 'list' })).toBe('/practice');
		expect(practiceHref({ view: 'weakest' })).toBe('/practice/weakest');
		expect(practiceHref({ view: 'drill', drill: 'sample' })).toBe('/practice/sample');
		expect(practiceHref({ view: 'drillWeakest', drill: 'sample' })).toBe('/practice/sample/weakest');
		expect(parsePracticeRoute(practiceHref({ view: 'drillWeakest', drill: 'sample' }).slice('/practice/'.length), ['sample'])).toEqual({ view: 'drillWeakest', drill: 'sample' });
		expect(parsePracticeRoute(practiceHref({ view: 'drill', drill: 'sample' }).slice('/practice/'.length), ['sample'])).toEqual({ view: 'drill', drill: 'sample' });
	});
});
