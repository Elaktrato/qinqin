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

	it('falls back to the list for a drill that does not apply or a longer path', () => {
		expect(parsePracticeRoute('counters', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('tone-pairs/extra', ['tone-pairs'])).toEqual({ view: 'list' });
		expect(parsePracticeRoute('weakest/x', [])).toEqual({ view: 'list' });
	});

	it('builds the hrefs it parses', () => {
		expect(practiceHref({ view: 'list' })).toBe('/practice');
		expect(practiceHref({ view: 'weakest' })).toBe('/practice/weakest');
		expect(practiceHref({ view: 'drill', drill: 'sample' })).toBe('/practice/sample');
		expect(parsePracticeRoute(practiceHref({ view: 'drill', drill: 'sample' }).slice('/practice/'.length), ['sample'])).toEqual({ view: 'drill', drill: 'sample' });
	});
});
