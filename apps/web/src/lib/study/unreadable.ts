// Rows the study load could not read (docs/contracts/sync/, "Reading rows"):
// a malformed row, or one a newer client wrote (a new member, a new kind).
// The load skips them and goes on; this module keeps the last load's count
// per workspace for the study page's notice and logs one warning per new
// report: collection, count and identities only, never row data.

import { writable } from 'svelte/store';
import type { StudyCollection } from './rows';

/** Unreadable rows per collection (typed collections and pluginData). */
export type UnreadableCounts = Partial<Record<StudyCollection | 'pluginData', number>>;

export interface UnreadableReport {
	workspaceId: number;
	counts: UnreadableCounts;
	total: number;
}

/** The last study load's report, or null when it read every row. */
export const unreadableRows = writable<UnreadableReport | null>(null);

let lastWarned = '';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * rawIdentity: the identity of a typed row the strict decode refused, when its
 * identity member is still readable (`id`, `deckId`; '' for the workspace
 * limits row and the active set), else null.
 */
export function rawIdentity(collection: StudyCollection, raw: unknown): string | null {
	if (!isRecord(raw)) return null;
	switch (collection) {
		case 'cards':
		case 'decks':
		case 'fsrsSets':
			return typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
		case 'deckSettings':
			return typeof raw.deckId === 'string' && raw.deckId !== '' ? raw.deckId : null;
		case 'limits':
			if (raw.deckId === null) return '';
			return typeof raw.deckId === 'string' && raw.deckId !== '' ? raw.deckId : null;
		case 'fsrsActive':
			return '';
	}
}

/** reportUnreadable records one load's unreadable rows (an empty count clears the report). */
export function reportUnreadable(workspaceId: number, counts: UnreadableCounts, keys: readonly string[]): void {
	const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
	if (total === 0) {
		unreadableRows.update((now) => (now === null || now.workspaceId === workspaceId ? null : now));
		return;
	}
	unreadableRows.set({ workspaceId, counts: { ...counts }, total });
	const signature = JSON.stringify([workspaceId, counts, keys]);
	if (signature === lastWarned) return;
	lastWarned = signature;
	const summary = Object.entries(counts).map(([collection, n]) => `${collection} ${n}`);
	console.warn(`study: skipped ${total} unreadable row(s) in workspace ${workspaceId}`, summary, 'kept unchanged:', keys);
}

/** clearUnreadableReport forgets the report (session end, tests). */
export function clearUnreadableReport(): void {
	unreadableRows.set(null);
	lastWarned = '';
}
