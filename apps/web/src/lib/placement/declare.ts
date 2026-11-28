// Declaration rules (#74), pure: which entries a "I already know this" range
// newly marks, and how the marks a declaration wrote are listed and undone.
// The marks are the reader's `known:<entryId>` rows (lib/studycore/knownMarks.ts);
// a declaration adds a batch id to the rows it writes. Design:
// docs/superpowers/specs/2026-11-26-placement-design.md.

import type { KnownBatch } from '$lib/studycore/knownMarks';

/** One level of a scheme: its members (words, or characters for a character scheme). */
export interface LevelMembers {
	id: number;
	name: string;
	entryIds: readonly number[];
}

/** The levels that have at least one entry (a placement probe needs something to ask). */
export function nonEmptyLevels<T extends LevelMembers>(levels: readonly T[]): T[] {
	return levels.filter((level) => level.entryIds.length > 0);
}

/** rangeEntries: every entry of the first `upTo` levels (1-based position in `levels`), once, in level order. */
export function rangeEntries(levels: readonly LevelMembers[], upTo: number): number[] {
	const seen = new Set<number>();
	for (const level of levels.slice(0, Math.max(0, upTo))) for (const id of level.entryIds) seen.add(id);
	return [...seen];
}

/** newMarks: the entries a declaration writes: those without a live mark. A live mark keeps its origin. */
export function newMarks(entryIds: readonly number[], marked: ReadonlySet<number>): number[] {
	return entryIds.filter((id) => !marked.has(id));
}

/** scopeLabel: the label stored with a declaration's marks ("HSK · HSK 3"); the screen words it ("Up to …"). */
export function scopeLabel(scheme: string, level: string): string {
	return `${scheme} · ${level}`;
}

export interface Declaration {
	id: string;
	source: KnownBatch['source'];
	scope: string;
	createdAt: string;
	/** The entries whose live mark still carries this batch: what Undo removes. */
	entryIds: number[];
}

/** declarations groups the live declared marks by batch, newest first. */
export function declarations(
	marks: readonly { entryId: number; createdAt: string; batch: KnownBatch }[]
): Declaration[] {
	const byId = new Map<string, Declaration>();
	for (const mark of marks) {
		const found = byId.get(mark.batch.id);
		if (found === undefined) {
			byId.set(mark.batch.id, {
				id: mark.batch.id,
				source: mark.batch.source,
				scope: mark.batch.scope,
				createdAt: mark.createdAt,
				entryIds: [mark.entryId]
			});
		} else {
			found.entryIds.push(mark.entryId);
			if (mark.createdAt > found.createdAt) found.createdAt = mark.createdAt;
		}
	}
	return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}
