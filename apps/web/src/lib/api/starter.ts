// Starter sets (#214): GET /api/starter-sets (the sets that ship with the server) and
// GET /api/starter-sets/{id} (one set's words resolved to dictionary entries, in the set's order).
// Contract: docs/contracts/starter/README.md.

import { api } from './client';
import type { EntryBase } from './types';

/** One element of GET /api/starter-sets. */
export interface StarterSetInfo {
	id: string;
	language: string;
	name: string;
	license: string;
	attribution: string;
	wordCount: number;
	/** False until a person has read the set; the UI then says it was reviewed by agents (#275). */
	humanReviewed: boolean;
}

/** One word of a set: the entry's base fields, its pinned reading, its gloss and the picture the set expects. */
export interface StarterSetEntry extends EntryBase {
	/** The reading the set pins the word to ('' or absent: none). */
	reading?: string;
	gloss: string;
	pictureConcept: string;
}

export interface StarterSetBody extends StarterSetInfo {
	entries: StarterSetEntry[];
}

/** starterSets lists the shipped sets (public). */
export function starterSets(): Promise<StarterSetInfo[]> {
	return api<StarterSetInfo[]>('/api/starter-sets', { auth: false });
}

/** starterSet loads one set's resolved words, in the set's order. */
export function starterSet(id: string): Promise<StarterSetBody> {
	return api<StarterSetBody>(`/api/starter-sets/${encodeURIComponent(id)}`);
}
