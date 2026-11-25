import { describe, expect, it } from 'vitest';
import { here, safeFrom } from './here';

describe('here and safeFrom', () => {
	it('here is the path and query of the page', () => {
		history.replaceState(null, '', '/flashcards?view=x');
		expect(here()).toBe('/flashcards?view=x');
		history.replaceState(null, '', '/');
	});

	it('keeps paths of this app, with their query and hash', () => {
		expect(safeFrom('/flashcards')).toBe('/flashcards');
		expect(safeFrom('/flashcards/deck/d1?x=1#top')).toBe('/flashcards/deck/d1?x=1#top');
	});

	// The query value as the page reads it (URLSearchParams decodes it), then the raw forms.
	const fromQuery = (encoded: string) => new URLSearchParams(`from=${encoded}`).get('from');
	it.each([
		['a tab before a second slash', fromQuery('/%09/evil.example')],
		['a newline before a second slash', fromQuery('/%0A/evil.example')],
		['a carriage return', fromQuery('/%0D/evil.example')],
		['a protocol-relative address', fromQuery('//evil.example')],
		['an encoded protocol-relative address', fromQuery('%2F%2Fevil.example')],
		['a backslash', fromQuery('/%5Cevil.example')],
		['a backslash raw', '/\\evil.example'],
		['an absolute address', fromQuery('https%3A%2F%2Fevil.example')],
		['javascript:', 'javascript:alert(1)'],
		['nothing', null],
		['empty', '']
	])('refuses %s', (_name, raw) => {
		const out = safeFrom(raw);
		expect(out).toBe('/');
		expect(new URL(out, location.origin).origin).toBe(location.origin);
	});
});
