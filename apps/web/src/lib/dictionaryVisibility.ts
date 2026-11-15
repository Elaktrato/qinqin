import type { Workspace } from './api/types';

/** The workspace settings key holding the hidden dictionary ids. */
export const HIDDEN_DICTIONARIES_KEY = 'hiddenDictionaries';

/**
 * hiddenDictionaries reads the dictionary ids a workspace hides.
 * Malformed values (strings, fractions, negatives) are ignored.
 */
export function hiddenDictionaries(ws: Workspace | null | undefined): Set<number> {
	const raw = ws?.settings?.[HIDDEN_DICTIONARIES_KEY];
	const out = new Set<number>();
	if (!Array.isArray(raw)) return out;
	for (const id of raw) {
		if (typeof id === 'number' && Number.isInteger(id) && id > 0) out.add(id);
	}
	return out;
}

/**
 * hiddenFor picks the hidden set of the workspace a book belongs to,
 * falling back to the current workspace when it is not in the list.
 */
export function hiddenFor(
	list: readonly Workspace[],
	workspaceId: number | null,
	current: Workspace | null
): Set<number> {
	const own = workspaceId === null ? undefined : list.find((w) => w.id === workspaceId);
	return hiddenDictionaries(own ?? current);
}

/**
 * partitionSenses splits a flat sense list into shown and hidden, order
 * kept. When every sense would be hidden, all are shown and allHidden is
 * set, so an entry never renders empty.
 */
export function partitionSenses<T extends { dictionaryId: number }>(
	senses: readonly T[],
	hidden: ReadonlySet<number>
): { shown: T[]; hidden: T[]; allHidden: boolean } {
	const shown = senses.filter((s) => !hidden.has(s.dictionaryId));
	if (senses.length > 0 && shown.length === 0) {
		return { shown: [...senses], hidden: [], allHidden: true };
	}
	return { shown, hidden: senses.filter((s) => hidden.has(s.dictionaryId)), allHidden: false };
}
