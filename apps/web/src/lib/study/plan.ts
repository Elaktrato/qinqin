// Planning a study write against what the server holds (#193): pure, no
// network. A snapshot (the cache's view of a workspace's stored rows, their
// last-write-wins stamps and the rows this version cannot read) decides which
// typed rows a command writes and with which stamp; nothing here sends.

import { newUlid } from '../ulid';
import { newCardId } from './canonical';
import { bodyOf, identityOf, sameBody, studyKey, type StudyCollection, type StudyRow, type StudyRowBody } from './rows';
import { UnreadableRowError } from './unreadable';
import type { StudyCard, StudyCardKind } from './types';

/**
 * What the server holds for the rows of one workspace, read with the study
 * data, so a write can be planned against it (studyWrite): `knownAt` is the
 * newest time per row (`<collection>:<identity>` for typed rows, the plugin
 * key for keyed rows), `stored` every typed row, tombstones included, and
 * `unreadable` the keys of typed rows this version cannot read (malformed,
 * or written by a newer client): never rewritten (docs/contracts/sync/,
 * 'Reading rows').
 */
export interface StudySnapshot {
	knownAt: Map<string, string>;
	stored: Map<string, StudyRow>;
	unreadable: Set<string>;
}

export function newSnapshot(): StudySnapshot {
	return { knownAt: new Map(), stored: new Map(), unreadable: new Set() };
}

/** The keys of typed rows in `knownAt` and `stored`: `<collection>:<identity>`. */
export const studyRowKey = {
	deck: (id: string): string => studyKey('decks', id),
	card: (id: string): string => studyKey('cards', id),
	settings: (deckId: string): string => studyKey('deckSettings', deckId),
};

/** One typed study write: the row's typed body (no meta), its stored time, and whether it is a tombstone. */
export interface StudyWrite {
	collection: StudyCollection;
	row: StudyRowBody;
	/** The newest time the server holds for the row (StudySnapshot.knownAt). */
	knownAt?: string;
	deleted?: true;
}

export type Snap = Partial<StudySnapshot> | undefined;

/** extraOf: the stored row's `extra` (a tombstone's too), echoed back on a write. */
export function extraOf(snap: Snap, collection: StudyCollection, identity: string): Record<string, unknown> {
	return { ...(snap?.stored?.get(studyKey(collection, identity))?.extra ?? {}) };
}

/**
 * studyWrite plans one typed write against what the server holds: null
 * when it would change nothing (the live row is equal, or a tombstone of a
 * row that is absent or already deleted) - the server would skip it, and a
 * skipped item reads as 'the server holds newer data'. A tombstone carries
 * the stored row's last data. A row this version cannot read is never
 * replaced: UnreadableRowError.
 */
export function studyWrite(
	snap: Snap,
	collection: StudyCollection,
	row: StudyRowBody,
	opts: { deleted?: boolean } = {},
): StudyWrite | null {
	const key = studyKey(collection, identityOf(collection, row));
	if (snap?.unreadable?.has(key) === true) throw new UnreadableRowError(key);
	const stored = snap?.stored?.get(key);
	const live = stored !== undefined && stored.deletedAt === null;
	const knownAt = snap?.knownAt?.get(key);
	const at = knownAt === undefined ? {} : { knownAt };
	if (opts.deleted === true) {
		if (!live) return null;
		return { collection, row: bodyOf(stored), ...at, deleted: true };
	}
	if (live && sameBody(stored, row)) return null;
	return { collection, row, ...at };
}

/** studyDelete: the tombstone of a stored row, or null when it is not live. */
export function studyDelete(snap: Snap, collection: StudyCollection, identity: string): StudyWrite | null {
	const stored = snap?.stored?.get(studyKey(collection, identity));
	return stored === undefined ? null : studyWrite(snap, collection, bodyOf(stored), { deleted: true });
}

/**
 * freshCardId picks the id of a new card (exported for planners such as
 * add-to-deck, docs/contracts/decks/add-to-deck.json). The derived id (`newCardId`)
 * makes two devices adding the same card at once write one key. It can
 * only be taken by a card with another cardKey for sentence cards (one
 * per sentence once existed), or by a stored card this version cannot read;
 * then the sentence joins the id, and a ULID is the last resort, so an
 * existing card is never overwritten.
 */
export function freshCardId(
	cards: readonly StudyCard[],
	unreadable: ReadonlySet<string>,
	kind: StudyCardKind,
	entryId: number,
	sentenceId?: number,
): string {
	const ids = new Set(cards.map((card) => card.id));
	const taken = { has: (id: string) => ids.has(id) || unreadable.has(studyRowKey.card(id)) };
	const base = newCardId(kind, entryId);
	if (!taken.has(base)) return base;
	if (kind === 'sentence' && sentenceId !== undefined) {
		const withSentence = `${base}-${sentenceId}`;
		if (!taken.has(withSentence)) return withSentence;
	}
	return newUlid();
}

