import type { Scheme } from './api/types';

/** The filters of the search page, mirrored in the URL. '' means unset. */
export interface SearchFilters {
	kind: string;
	scheme: string;
	level: string;
}

export const KINDS = ['character', 'word'] as const;

export function filtersFromParams(params: URLSearchParams): SearchFilters {
	const rawKind = params.get('kind') ?? '';
	const kind = (KINDS as readonly string[]).includes(rawKind) ? rawKind : '';
	const scheme = params.get('scheme') ?? '';
	// The API rejects a level without a scheme.
	const level = scheme ? (params.get('level') ?? '') : '';
	return { kind, scheme, level };
}

export function clearFilters(): SearchFilters {
	return { kind: '', scheme: '', level: '' };
}

export function hasFilters(f: SearchFilters): boolean {
	return f.kind !== '' || f.scheme !== '' || f.level !== '';
}

export function setKind(f: SearchFilters, kind: string): SearchFilters {
	return { ...f, kind: f.kind === kind ? '' : kind };
}

export function setScheme(f: SearchFilters, scheme: string): SearchFilters {
	if (f.scheme === scheme) return { ...f, scheme: '', level: '' };
	return { ...f, scheme, level: '' };
}

export function setLevel(f: SearchFilters, level: string): SearchFilters {
	return { ...f, level: f.level === level ? '' : level };
}

export function searchHref(q: string, f: SearchFilters, entryId?: number | null): string {
	const params = new URLSearchParams();
	if (q) params.set('q', q);
	if (f.kind) params.set('kind', f.kind);
	if (f.scheme) params.set('scheme', f.scheme);
	if (f.scheme && f.level) params.set('level', f.level);
	if (entryId != null) params.set('e', String(entryId));
	const s = params.toString();
	return s ? `/search?${s}` : '/search';
}

/** The URL of a submitted query: a new query drops the selected entry. */
export function submitHref(q: string, f: SearchFilters): string {
	return searchHref(q, f);
}

/** The URL after a filter change: the selected entry stays. */
export function filterHref(q: string, f: SearchFilters, entryId?: number | null): string {
	return searchHref(q, f, entryId);
}

/** selectedFromParams: the `e` entry id, or null when it is not a positive safe integer. */
export function selectedFromParams(params: URLSearchParams): number | null {
	const raw = params.get('e');
	if (raw === null || !/^[1-9]\d*$/.test(raw)) return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) ? n : null;
}

/** Schemes of the workspace language that carry a manifest id. */
export function schemesForLanguage(schemes: readonly Scheme[], language: string | null): Scheme[] {
	if (!language) return [];
	return schemes.filter((s) => s.language === language && !!s.packId);
}

/**
 * reconcileFilters drops a scheme (and its level) that is not among the
 * workspace language's schemes, and a level the scheme does not have, so
 * a filter hidden from the chips can never silently zero the results.
 * It returns the same object when nothing needs dropping.
 */
export function reconcileFilters(f: SearchFilters, schemes: readonly Scheme[]): SearchFilters {
	if (!f.scheme) return f;
	const scheme = schemes.find((s) => s.packId === f.scheme);
	if (!scheme) return { ...f, scheme: '', level: '' };
	if (f.level && !scheme.levels.some((l) => l.name === f.level)) return { ...f, level: '' };
	return f;
}
