// Starter decks (#75): "Top 500 / 1000 / 2000" of every installed frequency
// pack of the workspace language, computed by the server from the pack
// (GET /api/frequency-packs/{id}/top), never stored and never bundled. A
// copy is an ordinary deck with a deterministic id (ownedStarterDeckId) and
// the pack named on it. Contract: docs/contracts/frequency/README.md.

import type { FrequencyPack } from '$lib/api/types';
import type { StarterEntry } from '$lib/api/frequency';
import type { Deck } from '$lib/study/types';
import type { AddItem } from './addToDeck';
import { ownedStarterDeckId } from './systemDecks';

export const STARTER_SIZES = [500, 1000, 2000] as const;
export type StarterSize = (typeof STARTER_SIZES)[number];

export interface StarterDeck {
	kind: 'frequency';
	/** The pack's numeric id on this server (the route's `{id}`). */
	packNumId: number;
	/** The manifest id: the identity of a copy across servers. */
	packId: string;
	packName: string;
	license: string;
	attribution: string;
	size: StarterSize;
}

/** starterDecks: three decks per pack of `language`, in pack priority order. */
export function starterDecks(packs: readonly FrequencyPack[], language: string): StarterDeck[] {
	const code = language.toLowerCase();
	return packs
		.filter((pack) => pack.language.toLowerCase() === code)
		.flatMap((pack) =>
			STARTER_SIZES.map((size) => ({
				kind: 'frequency' as const,
				packNumId: pack.id,
				packId: pack.packId,
				packName: pack.name,
				license: pack.license,
				attribution: pack.attribution,
				size
			}))
		);
}

export function starterTitle(deck: StarterDeck): string {
	return `Top ${deck.size}`;
}

/** The owned copy's name: "<pack name> · Top <size>". */
export function starterDeckName(deck: StarterDeck): string {
	return `${deck.packName} · ${starterTitle(deck)}`;
}

/** The attribution line every starter deck shows. */
export function starterCredit(deck: StarterDeck): string {
	return `From ${deck.packName} · ${deck.license}`;
}

/** The add-to-deck target of a starter deck. */
export function starterTarget(deck: StarterDeck): {
	id: string;
	name: string;
	source: Deck['source'];
} {
	return {
		id: ownedStarterDeckId(deck.packId, deck.size),
		name: starterDeckName(deck),
		source: { type: 'frequency', packId: deck.packId, size: deck.size }
	};
}

/** The add items of a starter deck, in deck (rank) order. */
export function starterAddItems(entries: readonly StarterEntry[]): AddItem[] {
	return entries.map((entry) => ({ entryId: entry.id, written: entry.written }));
}
