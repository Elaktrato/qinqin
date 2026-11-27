// Per-deck card type switches: the deck settings row (typed collection
// `deckSettings`, docs/contracts/study/), so the implicit General deck can
// carry one too. Unknown fields are kept verbatim in `extra` so another
// feature's fields (or a newer client's) survive a read-modify-write.

import type { NewOrder } from './newOrder';
import { OPT_IN_KINDS, type OptInKind } from './types';

export interface DeckSettings {
	deckId: string;
	cardTypes: OptInKind[];
	/** The order of new cards (#75); absent, null or malformed = added. */
	newOrder?: NewOrder | null;
	/** Every field this version does not know, verbatim. */
	extra: Record<string, unknown>;
}

/** The known opt-in kinds of a list, in kind order, deduplicated. */
export function cleanCardTypes(list: readonly unknown[]): OptInKind[] {
	return OPT_IN_KINDS.filter((kind) => list.includes(kind));
}

/** The opt-in kinds any of the given decks enables. */
export function enabledKinds(
	settings: Readonly<Record<string, DeckSettings>> | undefined,
	deckIds: readonly string[]
): Set<OptInKind> {
	const out = new Set<OptInKind>();
	if (settings === undefined) return out;
	for (const id of deckIds) {
		for (const kind of settings[id]?.cardTypes ?? []) out.add(kind);
	}
	return out;
}
