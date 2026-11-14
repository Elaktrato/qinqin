import { describe, expect, it } from 'vitest';
import { legacyRedirect } from './legacyRoutes';

describe('legacyRedirect', () => {
	it('sends the old map URL to Stats → Characters', () => {
		expect(legacyRedirect({ pathname: '/study/map', search: '', hash: '' })).toBe(
			'/stats/characters'
		);
		expect(legacyRedirect({ pathname: '/study/map/', search: '', hash: '' })).toBe(
			'/stats/characters'
		);
	});

	it('keeps the query and the fragment', () => {
		expect(legacyRedirect({ pathname: '/study/map', search: '?q=1', hash: '#top' })).toBe(
			'/stats/characters?q=1#top'
		);
	});

	it('leaves every other path alone', () => {
		expect(legacyRedirect({ pathname: '/study', search: '', hash: '' })).toBeNull();
		expect(legacyRedirect({ pathname: '/study/mapx', search: '', hash: '' })).toBeNull();
		expect(legacyRedirect({ pathname: '/stats/characters', search: '', hash: '' })).toBeNull();
	});
});
