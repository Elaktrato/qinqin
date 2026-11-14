// The card types of the last session started in a workspace, kept across
// tabs in localStorage. The per-tab setup (sessionStorage) still wins; this
// is only the default for a tab without one, so opting into Word Salad,
// writing or tone once does not silently reset to vocab in a new tab while
// those cards stay due. The home widget counts the same types.

import { SESSION_CONFIG_KEY } from './session';
import { CARD_KINDS, type StudyCardKind } from './types';

export const LAST_CARD_TYPES_KEY = 'qinqin.study.cardTypes';

function known(list: readonly unknown[]): StudyCardKind[] {
	return CARD_KINDS.filter((kind) => list.includes(kind));
}

function parseAll(raw: string | null): Record<string, unknown> {
	if (raw === null) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** The remembered kinds of one workspace, or null when none are usable. */
export function parseRememberedTypes(raw: string | null, workspaceId: number): StudyCardKind[] | null {
	const list = parseAll(raw)[String(workspaceId)];
	if (!Array.isArray(list)) return null;
	const kinds = known(list);
	return kinds.length > 0 ? kinds : null;
}

/** The stored value with one workspace's kinds replaced (unknown ids dropped). */
export function withRememberedTypes(
	raw: string | null,
	workspaceId: number,
	types: readonly string[]
): string {
	return JSON.stringify({ ...parseAll(raw), [String(workspaceId)]: known(types) });
}

/** The tab's setup when it has valid kinds, else the remembered ones, else vocab. */
export function effectiveCardTypes(
	tabTypes: readonly string[] | null,
	remembered: StudyCardKind[] | null
): StudyCardKind[] {
	const fromTab = tabTypes === null ? [] : known(tabTypes);
	if (fromTab.length > 0) return fromTab;
	return remembered ?? ['vocab'];
}

function local(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadRememberedTypes(workspaceId: number): StudyCardKind[] | null {
	try {
		return parseRememberedTypes(local()?.getItem(LAST_CARD_TYPES_KEY) ?? null, workspaceId);
	} catch {
		return null;
	}
}

export function rememberCardTypes(workspaceId: number, types: readonly string[]): void {
	const store = local();
	if (store === null) return;
	try {
		store.setItem(
			LAST_CARD_TYPES_KEY,
			withRememberedTypes(store.getItem(LAST_CARD_TYPES_KEY), workspaceId, types)
		);
	} catch {
		// Private mode or a full quota: the next tab starts from vocab.
	}
}

/** Whether this tab has a saved setup of its own. */
export function hasTabSetup(): boolean {
	try {
		return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_CONFIG_KEY) !== null;
	} catch {
		return false;
	}
}
