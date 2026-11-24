import { describe, expect, it } from 'vitest';
import { grammarHref, parseGrammarRoute } from './route';

describe('parseGrammarRoute', () => {
	it('routes the three views', () => {
		expect(parseGrammarRoute('')).toEqual({ view: 'browse' });
		expect(parseGrammarRoute('/')).toEqual({ view: 'browse' });
		expect(parseGrammarRoute('zh-grammar/shi')).toEqual({
			view: 'lesson',
			pack: 'zh-grammar',
			lesson: 'shi'
		});
		expect(parseGrammarRoute('zh-grammar/shi/practice/')).toEqual({
			view: 'practice',
			pack: 'zh-grammar',
			lesson: 'shi'
		});
	});
	it('falls back to browse for anything else', () => {
		expect(parseGrammarRoute('a')).toEqual({ view: 'browse' });
		expect(parseGrammarRoute('a/b/c')).toEqual({ view: 'browse' });
		expect(parseGrammarRoute('a/b/practice/x')).toEqual({ view: 'browse' });
	});
	it('builds hrefs', () => {
		expect(grammarHref({ view: 'browse' })).toBe('/grammar');
		expect(grammarHref({ view: 'lesson', pack: 'p', lesson: 'l' })).toBe('/grammar/p/l');
		expect(grammarHref({ view: 'practice', pack: 'p', lesson: 'l' })).toBe('/grammar/p/l/practice');
	});
});
