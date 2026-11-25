import { describe, expect, it } from 'vitest';
import { here, safeFrom } from './here';

describe('here and safeFrom', () => {
	it('here is the path and query of the page', () => {
		history.replaceState(null, '', '/flashcards?view=x');
		expect(here()).toBe('/flashcards?view=x');
		history.replaceState(null, '', '/');
	});
	it('safeFrom keeps app paths only', () => {
		expect(safeFrom('/flashcards')).toBe('/flashcards');
		expect(safeFrom('//evil.example')).toBe('/');
		expect(safeFrom('/\\evil.example')).toBe('/');
		expect(safeFrom('https://evil.example')).toBe('/');
		expect(safeFrom(null)).toBe('/');
	});
});
