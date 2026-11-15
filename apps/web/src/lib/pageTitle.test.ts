import { describe, expect, it } from 'vitest';
import { pageTitle } from './pageTitle';

describe('pageTitle', () => {
	it('falls back to the app name', () => {
		expect(pageTitle()).toBe('qinqin');
		expect(pageTitle('')).toBe('qinqin');
		expect(pageTitle('   ')).toBe('qinqin');
	});

	it('puts the page first and the app name last', () => {
		expect(pageTitle('Search')).toBe('Search · qinqin');
	});

	it('joins several parts, skipping empty ones', () => {
		expect(pageTitle('Characters', 'Stats')).toBe('Characters · Stats · qinqin');
		expect(pageTitle('', 'Stats')).toBe('Stats · qinqin');
	});
});
