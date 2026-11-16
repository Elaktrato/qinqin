// Per-deck card type switches: plugin-data key `deckcfg:<deckId>` in the
// workspace, so the implicit General deck can carry one too. Unknown
// fields are kept verbatim so another feature's fields (or a newer
// client's) survive a read-modify-write.

import { parseNewOrder, type NewOrder } from './newOrder';
import { OPT_IN_KINDS, type OptInKind } from './types';

export const DECKCFG_PREFIX = 'deckcfg:';

export interface DeckSettings {
	deckId: string;
	cardTypes: OptInKind[];
	/** The order of new cards (#75); absent, null or malformed = added. */
	newOrder?: NewOrder | null;
	/** Every field this version does not know, verbatim. */
	extra: Record<string, unknown>;
}

export function deckSettingsKey(deckId: string): string {
	return `${DECKCFG_PREFIX}${deckId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The known opt-in kinds of a list, in kind order, deduplicated. */
export function cleanCardTypes(list: readonly unknown[]): OptInKind[] {
	return OPT_IN_KINDS.filter((kind) => list.includes(kind));
}

/** parseDeckSettings reads a row; the key must be `deckcfg:<deckId>`. */
export function parseDeckSettings(key: string, raw: unknown): DeckSettings | null {
	if (!isRecord(raw)) return null;
	const { deckId, cardTypes, newOrder, updatedAt: _updatedAt, ...extra } = raw;
	void _updatedAt;
	if (typeof deckId !== 'string' || deckId === '') return null;
	if (key !== deckSettingsKey(deckId)) return null;
	const order = parseNewOrder(newOrder);
	// An order this version cannot read (a newer client's) stays verbatim in
	// `extra`, so saving another field of the row keeps it.
	if (order === null && 'newOrder' in raw) extra.newOrder = newOrder;
	return {
		deckId,
		cardTypes: Array.isArray(cardTypes) ? cleanCardTypes(cardTypes) : [],
		...(order === null ? {} : { newOrder: order }),
		extra
	};
}

export function serializeDeckSettings(
	settings: DeckSettings,
	updatedAt: string
): Record<string, unknown> {
	const order = parseNewOrder(settings.newOrder);
	return {
		...settings.extra,
		deckId: settings.deckId,
		cardTypes: cleanCardTypes(settings.cardTypes),
		...(order === null ? {} : { newOrder: order }),
		updatedAt
	};
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
