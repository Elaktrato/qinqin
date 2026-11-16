// Frequency packs and what is computed from them (#75): the installed
// packs, entry ranks in the ranking pack, and starter decks. No frequency
// data ships with the app; everything comes from the server's packs.
// Contract: docs/contracts/frequency/README.md.

import { api } from './client';
import type { EntryBase, FrequencyPack } from './types';

/** The ranking pack named by POST /api/entries/frequency-ranks. */
export interface RankPack {
	id: number;
	packId: string;
	name: string;
	license: string;
	attribution: string;
}

export interface EntryRanksBody {
	pack: RankPack | null;
	ranks: { id: number; rank: number }[];
}

export interface StarterEntry extends EntryBase {
	rank: number;
}

export interface StarterBody {
	packId: string;
	name: string;
	size: number;
	entries: StarterEntry[];
}

/** getFrequencyPacks lists the installed frequency packs in priority order (public). */
export function getFrequencyPacks(): Promise<FrequencyPack[]> {
	return api<FrequencyPack[]>('/api/frequency-packs', { auth: false });
}

/** getEntryRanks asks for 1..500 entries' ranks in the language's ranking pack. */
export function getEntryRanks(language: string, ids: readonly number[]): Promise<EntryRanksBody> {
	return api<EntryRanksBody>('/api/entries/frequency-ranks', {
		method: 'POST',
		body: { language, ids: [...ids] }
	});
}

/** getStarterEntries loads a starter deck (Top 500/1000/2000) of a pack by its numeric id. */
export function getStarterEntries(packNumId: number, size: number): Promise<StarterBody> {
	return api<StarterBody>(`/api/frequency-packs/${packNumId}/top?size=${size}`);
}
