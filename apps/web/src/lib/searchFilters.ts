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

export function searchHref(q: string, f: SearchFilters): string {
	const params = new URLSearchParams();
	if (q) params.set('q', q);
	if (f.kind) params.set('kind', f.kind);
	if (f.scheme) params.set('scheme', f.scheme);
	if (f.scheme && f.level) params.set('level', f.level);
	const s = params.toString();
	return s ? `/search?${s}` : '/search';
}

/** Schemes of the workspace language that carry a manifest id. */
export function schemesForLanguage(schemes: readonly Scheme[], language: string | null): Scheme[] {
	if (!language) return [];
	return schemes.filter((s) => s.language === language && !!s.packId);
}
