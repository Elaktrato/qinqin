import { describe, expect, it } from 'vitest';
import { cjkLang, parseNotice, safeHref, scriptRuns } from './notice';

const text = (t: string) => ({ type: 'text', text: t });
const link = (t: string, href: string) => ({ type: 'link', text: t, href });

describe('parseNotice', () => {
	it('returns no paragraphs for empty, blank or missing input', () => {
		expect(parseNotice('')).toEqual([]);
		expect(parseNotice('  \n\n \t \n')).toEqual([]);
		expect(parseNotice(undefined)).toEqual([]);
		expect(parseNotice(null)).toEqual([]);
	});

	it('splits paragraphs on blank lines and joins soft line breaks', () => {
		expect(parseNotice('One\nline.\n\nTwo.\r\n\r\nThree.\n \nFour.')).toEqual([
			{ type: 'p', parts: [text('One line.')] },
			{ type: 'p', parts: [text('Two.')] },
			{ type: 'p', parts: [text('Three.')] },
			{ type: 'p', parts: [text('Four.')] }
		]);
	});

	it('turns https links into link parts', () => {
		expect(parseNotice('From [Jiten](https://jiten.moe/frequency-dictionaries), CC BY-SA.')).toEqual([
			{
				type: 'p',
				parts: [
					text('From '),
					link('Jiten', 'https://jiten.moe/frequency-dictionaries'),
					text(', CC BY-SA.')
				]
			}
		]);
	});

	it('keeps balanced parentheses inside a URL', () => {
		expect(parseNotice('[w](https://en.wikipedia.org/wiki/Foo_(bar))')[0].parts).toEqual([
			link('w', 'https://en.wikipedia.org/wiki/Foo_(bar)')
		]);
	});

	it.each([
		['http', '[x](http://example.com)'],
		['javascript', '[x](javascript:alert(1))'],
		['javascript upper', '[x](JAVASCRIPT:alert(1))'],
		['data', '[x](data:text/html,<script>alert(1)</script>)'],
		['relative', '[x](/ARPHICPL.TXT)'],
		['protocol-relative', '[x](//evil.example)'],
		['whitespace in url', '[x](https://a.example/ b)'],
		['newline smuggling', '[x](https://a.example/\u0000)'],
		['no host', '[x](https:///path)'],
		['empty label', '[](https://a.example)'],
		['blank label', '[   ](https://a.example)'],
		['unclosed bracket', '[x(https://a.example)'],
		['unclosed paren', '[x](https://a.example'],
		['space before paren', '[x] (https://a.example)']
	])('keeps %s as plain text', (_name, input) => {
		expect(parseNotice(input)).toEqual([{ type: 'p', parts: [text(input)] }]);
	});

	it('never yields HTML: markup in text and labels stays literal text', () => {
		const parts = parseNotice('<img src=x onerror=alert(1)> [<b>bold</b>](https://a.example/"><script>)')[0]
			.parts;
		expect(parts[0]).toEqual(text('<img src=x onerror=alert(1)> '));
		expect(parts[1]).toMatchObject({ type: 'link', text: '<b>bold</b>' });
		// The URL parser percent-encodes quotes and angle brackets.
		const href = (parts[1] as { href: string }).href;
		expect(href).not.toMatch(/["<>]/);
		expect(href.startsWith('https://a.example/')).toBe(true);
	});

	it('allows brackets inside link text', () => {
		expect(parseNotice('See [the [2021] list](https://a.example).')[0].parts).toEqual([
			text('See '),
			link('the [2021] list', 'https://a.example/'),
			text('.')
		]);
	});

	it('links the inner link of nested link syntax and keeps the outer as text', () => {
		expect(parseNotice('[a [b](https://b.example) c](https://c.example)')[0].parts).toEqual([
			text('[a '),
			link('b', 'https://b.example/'),
			text(' c](https://c.example)')
		]);
	});

	it('handles stray brackets around links', () => {
		expect(parseNotice('] [ [x](https://x.example) ] [y]')[0].parts).toEqual([
			text('] [ '),
			link('x', 'https://x.example/'),
			text(' ] [y]')
		]);
	});

	it('keeps CJK text and CJK link labels', () => {
		expect(parseNotice('《HSK 考试大纲》 [中外语言交流合作中心](https://www.chinesetest.cn)')[0].parts).toEqual([
			text('《HSK 考试大纲》 '),
			link('中外语言交流合作中心', 'https://www.chinesetest.cn/')
		]);
	});

	it('renders a userinfo link as plain text', () => {
		expect(parseNotice('[CTI](https://www.chinesetest.cn@evil.com)')).toEqual([
			{ type: 'p', parts: [{ type: 'text', text: '[CTI](https://www.chinesetest.cn@evil.com)' }] }
		]);
	});

	it('drops bidi override and isolate characters, which could reorder the text', () => {
		const controls = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
		expect(parseNotice(`a${controls}b [x\u202e](https://example.org/\u2066)`)).toEqual([
			{
				type: 'p',
				parts: [
					{ type: 'text', text: 'ab ' },
					{ type: 'link', text: 'x', href: 'https://example.org/' }
				]
			}
		]);
		// Marks that only set direction (LRM, RLM) stay.
		expect(parseNotice('a\u200eb')[0].parts).toEqual([{ type: 'text', text: 'a\u200eb' }]);
	});

	it('parses very long and hostile input without blowing up', () => {
		const long = 'word '.repeat(20000) + '[end](https://e.example)';
		const parts = parseNotice(long)[0].parts;
		expect(parts[parts.length - 1]).toEqual(link('end', 'https://e.example/'));

		const hostile = '['.repeat(50000) + '('.repeat(50000) + ']'.repeat(10);
		// A backtracking regression shows as a test timeout, not a time assertion.
		const result = parseNotice(hostile);
		expect(result[0].parts).toEqual([text(hostile)]);
	});
});

describe('safeHref', () => {
	it('normalises https URLs and rejects everything else', () => {
		expect(safeHref('https://www.aozora.gr.jp')).toBe('https://www.aozora.gr.jp/');
		expect(safeHref('HTTPS://Example.com/A')).toBe('https://example.com/A');
		expect(safeHref('http://example.com')).toBeNull();
		expect(safeHref(' https://example.com')).toBeNull();
		expect(safeHref('https:example.com')).toBeNull();
		expect(safeHref('')).toBeNull();
	});

	it('rejects URLs carrying user information, like the server', () => {
		expect(safeHref('https://www.chinesetest.cn@evil.com')).toBeNull();
		expect(safeHref('https://user:pw@example.com/')).toBeNull();
		expect(safeHref('https://:pw@example.com/')).toBeNull();
		expect(safeHref('https://@example.com/')).toBeNull();
		expect(safeHref('https://example.com/a@b')).toBe('https://example.com/a@b');
	});
});

describe('cjkLang', () => {
	it('prefers Japanese when kana is present', () => {
		expect(cjkLang('かぜ 風', 'zh')).toBe('ja');
	});
	it('reads a bare zh as simplified and keeps explicit tags', () => {
		expect(cjkLang('汉字大纲', 'zh')).toBe('zh-Hans');
		expect(cjkLang('漢字', 'zh-Hant')).toBe('zh-Hant');
		expect(cjkLang('分, 可', 'ja')).toBe('ja');
		expect(cjkLang('한국어', 'ko')).toBe('ko');
	});
	it('is und when the language is unknown or not CJK', () => {
		expect(cjkLang('汉字', undefined)).toBe('und');
		expect(cjkLang('汉字', 'es')).toBe('und');
	});
});

describe('scriptRuns', () => {
	it('tags Han-only runs with the given language and leaves the rest untagged', () => {
		expect(scriptRuns('The HSK 汉字大纲 list (认读字).', 'zh-Hans')).toEqual([
			{ text: 'The HSK ' },
			{ text: '汉字大纲', lang: 'zh-Hans' },
			{ text: ' list (' },
			{ text: '认读字', lang: 'zh-Hans' },
			{ text: ').' }
		]);
	});
	it('tags runs with kana ja and runs with Hangul ko, whatever the Han language', () => {
		expect(scriptRuns('a 吾輩は猫 b 한국 c 書写', 'zh-Hans')).toEqual([
			{ text: 'a ' },
			{ text: '吾輩は猫', lang: 'ja' },
			{ text: ' b ' },
			{ text: '한국', lang: 'ko' },
			{ text: ' c ' },
			{ text: '書写', lang: 'zh-Hans' }
		]);
	});
	it('keeps CJK punctuation inside a run', () => {
		expect(scriptRuns('《考试大纲》', 'zh-Hans')).toEqual([{ text: '《考试大纲》', lang: 'zh-Hans' }]);
	});
	it('keeps astral Han characters whole', () => {
		expect(scriptRuns('a𠀋b', 'ja')).toEqual([{ text: 'a' }, { text: '𠀋', lang: 'ja' }, { text: 'b' }]);
	});
	it('returns nothing for empty text', () => {
		expect(scriptRuns('', 'zh')).toEqual([]);
	});
});
