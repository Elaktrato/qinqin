import { describe, expect, it } from 'vitest';
import { LIBRARY_HREF, SOURCES_HREF, bookHref, parseRoute } from './route';

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
		expect(LIBRARY_HREF).toBe('/p/reader');
		expect(SOURCES_HREF).toBe('/p/reader/sources');
		expect(bookHref(12)).toBe('/p/reader/book/12/0');
		expect(bookHref(12, 3)).toBe('/p/reader/book/12/3');
	});
});
