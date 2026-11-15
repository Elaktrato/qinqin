import { describe, expect, it } from 'vitest';
import type { Scheme } from './api/types';
import {
	clearFilters,
	filtersFromParams,
	hasFilters,
	searchHref,
	setKind,
	setLevel,
	setScheme,
	schemesForLanguage
} from './searchFilters';

describe('filtersFromParams', () => {
	it('reads kind, scheme and level', () => {
		const f = filtersFromParams(new URLSearchParams('q=a&kind=word&scheme=hsk&level=HSK 1'));
		expect(f).toEqual({ kind: 'word', scheme: 'hsk', level: 'HSK 1' });
	});
	it('ignores unknown kinds and a level without a scheme', () => {
		expect(filtersFromParams(new URLSearchParams('kind=x&level=1'))).toEqual({
			kind: '',
			scheme: '',
			level: ''
		});
	});
});

describe('toggles', () => {
	const none = { kind: '', scheme: '', level: '' };
	it('kind toggles off when pressed again', () => {
		expect(setKind(none, 'word').kind).toBe('word');
		expect(setKind({ ...none, kind: 'word' }, 'word').kind).toBe('');
	});
	it('changing scheme drops the level; pressing again clears both', () => {
		const f = { kind: '', scheme: 'a', level: 'L1' };
		expect(setScheme(f, 'b')).toEqual({ kind: '', scheme: 'b', level: '' });
		expect(setScheme(f, 'a')).toEqual(none);
	});
	it('level toggles', () => {
		const f = { kind: '', scheme: 'a', level: '' };
		expect(setLevel(f, 'L1').level).toBe('L1');
		expect(setLevel({ ...f, level: 'L1' }, 'L1').level).toBe('');
	});
	it('clearFilters and hasFilters', () => {
		expect(hasFilters(clearFilters())).toBe(false);
		expect(hasFilters({ ...none, kind: 'word' })).toBe(true);
	});
});

describe('searchHref', () => {
	it('builds a shareable path', () => {
		expect(searchHref('学', { kind: 'word', scheme: 'hsk', level: 'HSK 1' })).toBe(
			'/search?q=%E5%AD%A6&kind=word&scheme=hsk&level=HSK+1'
		);
		expect(searchHref('', { kind: '', scheme: '', level: '' })).toBe('/search');
		expect(searchHref('', { kind: 'word', scheme: '', level: '' })).toBe('/search?kind=word');
	});
});

describe('schemesForLanguage', () => {
	it('keeps matching languages that have a pack id', () => {
		const s = (id: number, language: string, packId?: string) =>
			({ id, name: 'n' + id, unit: 'w', language, packId, levels: [] }) as Scheme;
		expect(schemesForLanguage([s(1, 'zh', 'a'), s(2, 'ja', 'b'), s(3, 'zh')], 'zh')).toHaveLength(1);
		expect(schemesForLanguage([s(1, 'zh', 'a')], null)).toEqual([]);
	});
});
