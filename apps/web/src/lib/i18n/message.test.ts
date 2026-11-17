import { describe, expect, it } from 'vitest';
import { MessageError, formatMessage, formatParts, messageShape, parseMessage, pluralCategory } from './message';

// Unit cases beside the shared fixtures (contract.test.ts): the parsed shape, production fallback, caching.

const kind = (f: () => unknown): string | undefined => {
	try {
		f();
	} catch (e) {
		return e instanceof MessageError ? e.kind : `not a MessageError: ${String(e)}`;
	}
	return undefined;
};

describe('parseMessage', () => {
	it('parses text, arguments and tags into segments', () => {
		expect(parseMessage("Don't {verb} <link>{name}</link>").segments).toEqual([
			{ type: 'text', value: "Don't " },
			{ type: 'arg', name: 'verb' },
			{ type: 'text', value: ' ' },
			{ type: 'tag', name: 'link', children: [{ type: 'arg', name: 'name' }] }
		]);
	});

	it('parses a plural into branches with # as the count', () => {
		const p = parseMessage('{n, plural, one {# day in {deck}} other {# days}}');
		expect(p.plural).toEqual({
			arg: 'n',
			branches: {
				one: [{ type: 'count' }, { type: 'text', value: ' day in ' }, { type: 'arg', name: 'deck' }],
				other: [{ type: 'count' }, { type: 'text', value: ' days' }]
			}
		});
		expect(p.segments).toEqual([]);
	});

	it('an empty message is valid', () => {
		expect(parseMessage('').segments).toEqual([]);
	});

	it('reports each invalid kind', () => {
		expect(kind(() => parseMessage('{g, select, a {x} other {y}}'))).toBe('select');
		expect(kind(() => parseMessage('{n, plural, =0 {x} other {y}}'))).toBe('exactMatch');
		expect(kind(() => parseMessage('{n, plural, one {{m, plural, other {a}}} other {y}}'))).toBe('nestedPlural');
		expect(kind(() => parseMessage('x {n, plural, other {y}}'))).toBe('partialPlural');
		expect(kind(() => parseMessage('{n, plural, one {y}}'))).toBe('missingOther');
		expect(kind(() => parseMessage('{ x'))).toBe('unbalanced');
		expect(kind(() => parseMessage('x }'))).toBe('unbalanced');
		expect(kind(() => parseMessage('a < b'))).toBe('badTag');
		expect(kind(() => parseMessage('#1'))).toBe('strayHash');
		expect(kind(() => parseMessage('{Bad}'))).toBe('badArgName');
		expect(kind(() => parseMessage('<a><b>x</b></a>'))).toBe('nestedTag');
		expect(kind(() => parseMessage('{n, plural, other {<b>#</b>}}'))).toBe('tagInPlural');
	});

	it('a MessageError names the message', () => {
		expect(() => parseMessage('Item #3')).toThrow(/Item #3/);
	});
});

describe('messageShape', () => {
	it('lists arguments, tags and plural-ness for the catalogue parity check', () => {
		expect(messageShape('{n, plural, one {# in {deck}} other {# in {deck}}}')).toEqual({
			args: ['deck', 'n'],
			tags: [],
			plural: true,
			categories: ['one', 'other']
		});
		expect(messageShape('<b>{a}</b> and <link>{b}</link> {a}')).toEqual({
			args: ['a', 'b'],
			tags: ['b', 'link'],
			plural: false,
			categories: []
		});
	});
});

describe('formatMessage', () => {
	it('throws on a missing argument by default and keeps {name} in production mode', () => {
		expect(kind(() => formatMessage('Hi {name}', 'en', {}))).toBe('missingArg');
		expect(formatMessage('Hi {name}', 'en', {}, { missing: 'keep' })).toBe('Hi {name}');
		expect(formatMessage('{n, plural, one {# x} other {# {y}}}', 'en', { n: 2 }, { missing: 'keep' })).toBe('2 {y}');
	});

	it('an argument named like an Object.prototype member is missing unless passed (own properties only)', () => {
		for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
			expect(kind(() => formatMessage(`Hi {${name}}`, 'en', {}))).toBe('missingArg');
			expect(formatMessage(`Hi {${name}}`, 'en', {}, { missing: 'keep' })).toBe(`Hi {${name}}`);
			expect(formatMessage(`Hi {${name}}`, 'en', { [name]: 'x' })).toBe('Hi x');
			expect(kind(() => formatParts(`{${name}, plural, other {# x}}`, 'en', {}))).toBe('missingArg');
			expect(formatMessage(`{${name}, plural, other {# x}}`, 'en', {}, { missing: 'keep' })).toBe(`{${name}} x`);
		}
	});

	it('in production mode a missing plural argument shows the other branch with {n}', () => {
		expect(formatMessage('{n, plural, one {# day} other {# days}}', 'en', {}, { missing: 'keep' })).toBe('{n} days');
	});

	it('formats # with the locale', () => {
		expect(formatMessage('{n, plural, other {# x}}', 'de', { n: 1234 })).toBe('1.234 x');
	});

	it('accepts a parsed message', () => {
		expect(formatMessage(parseMessage('Hi {a}'), 'en', { a: 'b' })).toBe('Hi b');
	});

	it('falls back to en when the locale is not a valid tag', () => {
		expect(formatMessage('{n, plural, one {# day} other {# days}}', 'not a locale!', { n: 1 })).toBe('1 day');
	});
});

describe('formatParts', () => {
	it('merges adjacent text and drops empty text', () => {
		expect(formatParts('{a}{b}<x>c</x>', 'en', { a: '1', b: '' })).toEqual([{ text: '1' }, { tag: 'x', text: 'c' }]);
	});
	it('keeps an empty tag', () => {
		expect(formatParts('a<x></x>', 'en', {})).toEqual([{ text: 'a' }, { tag: 'x', text: '' }]);
	});
});

describe('pluralCategory', () => {
	it('uses CLDR rules', () => {
		expect(pluralCategory('en', 1)).toBe('one');
		expect(pluralCategory('ru', 22)).toBe('few');
		expect(pluralCategory('ar', 0)).toBe('zero');
	});
});
