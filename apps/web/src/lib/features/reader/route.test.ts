import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/sentence-sources.json';
import type { SentenceSource } from '$lib/api/types';
import { LIBRARY_HREF, SOURCES_HREF, bookHref, parseAt, parseRoute, safeHttpUrl, sourceHref } from './route';

describe('sentence source links (contract reader/sentence-sources.json)', () => {
	for (const c of fixture.link) {
		it(`link: ${c.name}`, () => expect(sourceHref(c.source as SentenceSource)).toBe(c.want));
	}
	for (const c of fixture.at) {
		it(`at: ${c.name}`, () => expect(parseAt(c.at)).toEqual(c.want));
	}
	it('a link parses back to its place', () => {
		const href = sourceHref({ kind: 'book', bookId: 5, title: '', chapter: 2, paragraph: 4, start: 10, end: 12 })!;
		const url = new URL(href, 'http://x');
		expect(parseRoute(url.pathname.slice(LIBRARY_HREF.length))).toEqual({ view: 'book', id: 5, chapter: 2 });
		expect(parseAt(url.searchParams.get('at'))).toEqual({ paragraph: 4, start: 10, end: 12 });
	});
});

const library = { view: 'library' };

describe('parseRoute', () => {
	it('maps the empty path and sources', () => {
		expect(parseRoute('')).toEqual(library);
		expect(parseRoute('/')).toEqual(library);
		expect(parseRoute('sources')).toEqual({ view: 'sources' });
		expect(parseRoute('/sources/')).toEqual({ view: 'sources' });
	});

	it('parses book routes with a default chapter of 0', () => {
		expect(parseRoute('book/12')).toEqual({ view: 'book', id: 12, chapter: 0 });
		expect(parseRoute('book/12/3')).toEqual({ view: 'book', id: 12, chapter: 3 });
		expect(parseRoute('/book/12/0/')).toEqual({ view: 'book', id: 12, chapter: 0 });
	});

	it('falls back to the library for anything malformed', () => {
		for (const rest of [
			'nope',
			'book',
			'book/',
			'book/abc',
			'book/-1',
			'book/0',
			'book/1.5',
			'book/1e2',
			'book/12/x',
			'book/12/-1',
			'book/12/1.5',
			'book/12/3/extra',
			'sources/extra'
		]) {
			expect(parseRoute(rest), rest).toEqual(library);
		}
	});
});

describe('hrefs', () => {
	it('builds paths', () => {
		expect(LIBRARY_HREF).toBe('/reader');
		expect(SOURCES_HREF).toBe('/reader/sources');
		expect(bookHref(12)).toBe('/reader/book/12/0');
		expect(bookHref(12, 3)).toBe('/reader/book/12/3');
	});
});

describe('safeHttpUrl', () => {
	it('keeps http and https URLs', () => {
		expect(safeHttpUrl('https://www.aozora.gr.jp/cards/1.html')).toBe(
			'https://www.aozora.gr.jp/cards/1.html'
		);
		expect(safeHttpUrl('http://example.org/')).toBe('http://example.org/');
	});

	it('drops every other scheme and empty input', () => {
		for (const bad of ['', 'javascript:alert(1)', 'data:text/html,x', '//example.org', ' https://x']) {
			expect(safeHttpUrl(bad)).toBe('');
		}
	});
});
