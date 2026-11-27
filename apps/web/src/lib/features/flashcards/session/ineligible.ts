// A per-tab memory of companions found ineligible (a word without a
// sentence, a word without Han characters, a Chinese word without a clean
// pinyin reading). Planning skips them in later sessions of this tab, so a
// deck full of unsuitable words is not fetched entry by entry every time.
// It lives in sessionStorage, keyed per workspace: a new tab (or new
// content, after a reload in a new tab) checks the words again.

import type { StudyCardKind } from '$lib/studycore/types';

export const INELIGIBLE_KEY = 'qinqin.study.ineligible';

/** Newest entries kept per workspace; plenty for one tab. */
const MAX_PER_WORKSPACE = 5000;

export function ineligibleKey(kind: StudyCardKind, entryId: number): string {
	return `${kind}:${entryId}`;
}

function parseAll(raw: string | null): Record<string, string[]> {
	if (raw === null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
	const out: Record<string, string[]> = {};
	for (const [workspace, list] of Object.entries(parsed as Record<string, unknown>)) {
		if (!Array.isArray(list)) continue;
		out[workspace] = list.filter((key): key is string => typeof key === 'string');
	}
	return out;
}

/** The remembered `kind:entryId` keys of one workspace. */
export function parseIneligible(raw: string | null, workspaceId: number): Set<string> {
	return new Set(parseAll(raw)[String(workspaceId)] ?? []);
}

/** The stored value with `key` added for one workspace (oldest dropped past `max`). */
export function withIneligible(
	raw: string | null,
	workspaceId: number,
	key: string,
	max = MAX_PER_WORKSPACE
): string {
	const all = parseAll(raw);
	const list = all[String(workspaceId)] ?? [];
	if (list.includes(key) && raw !== null) return raw;
	all[String(workspaceId)] = [...list, key].slice(-Math.max(1, max));
	return JSON.stringify(all);
}

function storage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

export function loadIneligible(workspaceId: number): Set<string> {
	try {
		return parseIneligible(storage()?.getItem(INELIGIBLE_KEY) ?? null, workspaceId);
	} catch {
		return new Set();
	}
}

export function rememberIneligible(workspaceId: number, key: string): void {
	const store = storage();
	if (store === null) return;
	try {
		store.setItem(INELIGIBLE_KEY, withIneligible(store.getItem(INELIGIBLE_KEY), workspaceId, key));
	} catch {
		// Private mode or a full quota: the word is simply checked again.
	}
}
