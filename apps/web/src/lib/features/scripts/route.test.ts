import { describe, expect, it } from 'vitest';
import { parseScriptsRoute, scriptsHref } from './route';

const kana = ['hiragana', 'katakana'];

describe('parseScriptsRoute', () => {
	it('shows the first system of the language by default', () => {
		expect(parseScriptsRoute('', kana)).toEqual({ view: 'overview', system: 'hiragana' });
	});

	it('picks a named system and a practice round', () => {
		expect(parseScriptsRoute('katakana', kana)).toEqual({ view: 'overview', system: 'katakana' });
		expect(parseScriptsRoute('katakana/practice/recall', kana)).toEqual({ view: 'practice', system: 'katakana', mode: 'recall' });
		expect(parseScriptsRoute('/katakana/practice/type/', kana)).toEqual({ view: 'practice', system: 'katakana', mode: 'type' });
	});

	it('falls back for a system the language does not have, a bad mode or a long path', () => {
		expect(parseScriptsRoute('hangul', kana)).toEqual({ view: 'overview', system: 'hiragana' });
		expect(parseScriptsRoute('hangul/practice/recall', kana)).toEqual({ view: 'overview', system: 'hiragana' });
		expect(parseScriptsRoute('hiragana/practice/fly', kana)).toEqual({ view: 'overview', system: 'hiragana' });
		expect(parseScriptsRoute('hiragana/practice/recall/extra', kana)).toEqual({ view: 'overview', system: 'hiragana' });
	});

	it('has no system when the language has none', () => {
		expect(parseScriptsRoute('hiragana', [])).toEqual({ view: 'overview', system: '' });
	});

	it('builds the hrefs it parses', () => {
		const r = { view: 'practice', system: 'hangul', mode: 'read' } as const;
		expect(parseScriptsRoute(scriptsHref(r).slice('/scripts/'.length), ['hangul'])).toEqual(r);
		expect(scriptsHref({ view: 'home' })).toBe('/scripts');
		expect(scriptsHref({ view: 'overview', system: 'cyrillic' })).toBe('/scripts/cyrillic');
	});
});
