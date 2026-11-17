// Starter decks (#75): "Top 500 / 1000 / 2000" of every installed frequency
// pack of the workspace language, computed by the server from the pack
// (GET /api/frequency-packs/{id}/top), never stored and never bundled. A
// copy is an ordinary deck with a deterministic id (ownedStarterDeckId) and
// the pack named on it. Contract: docs/contracts/frequency/README.md.

import type { FrequencyPack } from '$lib/api/types';
import { getStarterEntries, type StarterEntry } from '$lib/api/frequency';
import type { Deck } from '$lib/study/types';
import type { AddItem, AddPlan } from './addToDeck';
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

/** starterView: the deck's words without the known ones, and the line saying how many were skipped. */
export function starterView(
	entries: readonly StarterEntry[],
	known: ReadonlySet<number>
): { shown: StarterEntry[]; known: number; knownLine: string | null } {
	const shown = entries.filter((entry) => !known.has(entry.id));
	const skipped = entries.length - shown.length;
	return {
		shown,
		known: skipped,
		knownLine: skipped === 0 ? null : `${skipped} known ${skipped === 1 ? 'word' : 'words'} skipped`
	};
}

/** starterAddedText: "Added 480 words; 20 you know were skipped". */
export function starterAddedText(plan: AddPlan): string {
	const added = plan.created + plan.joined;
	const text = `Added ${added} ${added === 1 ? 'word' : 'words'}`;
	const known = plan.known ?? 0;
	if (known === 0) return text;
	return `${text}; ${known} you know ${known === 1 ? 'was' : 'were'} skipped`;
}

// The words of a starter deck, loaded on demand and kept for the session.
// The server resolves them once per pack content; a pack re-install shows
// after a reload. Failures are not cached.
const cache = new Map<string, Promise<StarterEntry[]>>();

/** clearStarterCache forgets every loaded starter deck (tests). */
export function clearStarterCache(): void {
	cache.clear();
}

/** loadStarterEntries: the words of one starter deck, in deck order. */
export function loadStarterEntries(packNumId: number, size: number): Promise<StarterEntry[]> {
	const key = `${packNumId}/${size}`;
	let pending = cache.get(key);
	if (pending === undefined) {
		pending = getStarterEntries(packNumId, size).then((body) =>
			Array.isArray(body?.entries) ? body.entries : []
		);
		cache.set(key, pending);
		pending.catch(() => cache.delete(key));
	}
	return pending;
}

/**
 * duplicateGlosses: entry id -> gloss for the words whose display form occurs
 * more than once in the list (なる 成る "to become" / 生る "to bear fruit"), so
 * the list can tell them apart; words without a gloss are left out.
 */
export function duplicateGlosses(entries: readonly StarterEntry[]): Map<number, string> {
	const count = new Map<string, number>();
	for (const e of entries) count.set(e.written, (count.get(e.written) ?? 0) + 1);
	const out = new Map<number, string>();
	for (const e of entries) {
		if ((count.get(e.written) ?? 0) > 1 && e.gloss) out.set(e.id, e.gloss);
	}
	return out;
}
