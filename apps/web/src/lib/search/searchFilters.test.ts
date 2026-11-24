import { describe, expect, it } from 'vitest';
import type { Scheme } from '$lib/api/types';
import {
	clearFilters,
	filtersFromParams,
	hasFilters,
	reconcileFilters,
	searchHref,
	selectedFromParams,
	submitHref,
	filterHref,
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

describe('the selected entry (#104)', () => {
	it('searchHref writes q, kind, scheme, level, e in that order and omits empty ones', () => {
		expect(searchHref('学', { kind: 'word', scheme: 'hsk', level: 'HSK 1' }, 42)).toBe(
			'/search?q=%E5%AD%A6&kind=word&scheme=hsk&level=HSK+1&e=42'
		);
		expect(searchHref('', clearFilters(), 7)).toBe('/search?e=7');
		expect(searchHref('学', clearFilters())).toBe('/search?q=%E5%AD%A6');
	});
	it('selectedFromParams accepts only a positive safe integer', () => {
		expect(selectedFromParams(new URLSearchParams('e=42'))).toBe(42);
		for (const bad of ['0', '-1', '1.5', '1e3', 'abc', '9007199254740993', '']) {
			expect(selectedFromParams(new URLSearchParams('e=' + bad))).toBeNull();
		}
		expect(selectedFromParams(new URLSearchParams(''))).toBeNull();
	});
	it('a submitted query drops e; a filter change keeps it', () => {
		expect(submitHref('学', { kind: 'word', scheme: '', level: '' })).toBe('/search?q=%E5%AD%A6&kind=word');
		expect(filterHref('学', { kind: '', scheme: 'hsk', level: '' }, 42)).toBe(
			'/search?q=%E5%AD%A6&scheme=hsk&e=42'
		);
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

describe('reconcileFilters', () => {
	const mk = (packId: string, levels: string[]) =>
		({ id: 1, name: packId, unit: 'w', language: 'zh', packId, levels: levels.map((name, i) => ({ id: i, ord: i, name })) }) as Scheme;
	const zh = [mk('hsk', ['HSK 1'])];
	it('drops a scheme that does not belong to the language, with its level', () => {
		expect(reconcileFilters({ kind: 'word', scheme: 'jlpt', level: 'N5' }, zh)).toEqual({
			kind: 'word',
			scheme: '',
			level: ''
		});
	});
	it('drops only an unknown level', () => {
		expect(reconcileFilters({ kind: '', scheme: 'hsk', level: 'N5' }, zh)).toEqual({
			kind: '',
			scheme: 'hsk',
			level: ''
		});
	});
	it('returns the same object when nothing changes', () => {
		const f = { kind: '', scheme: 'hsk', level: 'HSK 1' };
		expect(reconcileFilters(f, zh)).toBe(f);
	});
});
