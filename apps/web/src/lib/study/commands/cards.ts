// Card commands (#193): add, delete, restore, move, and the per-word card kind
// switches (skipKinds). Each plans against the workspace's view (data.ts) and
// writes through commands/write.ts; multi-row writes report what landed with
// PartialCardsError.

import { errorText } from '../../api/apiErrors';
import { ShownError } from '../../api/userError';
import { t } from '../../i18n';
import { cleanSkipKinds, compareCanonical } from '../canonical';
import { cardKey } from '../reviewParse';
import { cardRow } from '../rows';
import { GENERAL_DECK_ID, type StudyCard, type StudyCardKind } from '../types';
import { extraOf, freshCardId, studyDelete, studyWrite, type StudySnapshot } from '../plan';
import { planningView } from '../data';
import { pushOptional, pushStudy, requireWorkspaceArg } from './write';

/**
 * addCard stores a new card (vocab unless `kind` says otherwise) and
 * returns it. Cards dedupe by `cardKey`: kind, entry and, for sentence
 * cards, the sentence. `written` snapshots the
 * entry's written form, which per-character mastery reads without another
 * entry fetch; `sentenceId` keeps the example sentence shown on the review
 * front; `deckIds` names the decks the card belongs to (General by
 * default; unknown ids are the caller's choice — the setup page only
 * offers decks that exist). Adding an entry that already has a card is a
 * no-op: the entry page can race a slow pull, and a second card would
 * split its reviews and EXP. A new card's id is derived from its kind and
 * entry (`newCardId`), so two devices that both miss each other's card
 * write the same key and sync keeps one row (the later write's fields:
 * decks, snapshot, createdAt; reviews point at the shared id either way).
 * Older duplicates are merged at read time (loadStudyData). `workspaceId` is
 * the workspace the caller captured when the user acted (the reader adds to
 * the book's workspace).
 */
export async function addCard(
	workspaceId: number,
	entryId: number,
	opts: {
		kind?: StudyCardKind;
		written?: string;
		entryKind?: 'character';
		sentenceId?: number;
		deckIds?: string[];
	} = {},
): Promise<StudyCard> {
	requireWorkspaceArg(workspaceId, 'addCard');
	const kind = opts.kind ?? 'vocab';
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	const wanted = cardKey(kind, entryId, opts.sentenceId);
	// Several stored duplicates: answer with the one loadStudyData keeps.
	const existing = cards
		.filter(
			(card) => cardKey(card.kind, card.entryId, card.sentenceId) === wanted,
		)
		.sort(compareCanonical)[0];
	if (existing !== undefined) return existing;
	const deckIds = opts.deckIds ?? [GENERAL_DECK_ID];
	const chosen = [...new Set(deckIds.filter((id) => id !== ''))];
	const card: StudyCard = {
		id: freshCardId(cards, snap.unreadable, kind, entryId, opts.sentenceId),
		kind,
		entryId,
		deckIds: chosen.length === 0 ? [GENERAL_DECK_ID] : chosen,
		createdAt: new Date().toISOString(),
	};
	if (typeof opts.written === 'string') {
		card.written = opts.written;
	}
	if (opts.entryKind === 'character') {
		card.entryKind = 'character';
	}
	if (opts.sentenceId !== undefined) {
		card.sentenceId = opts.sentenceId;
	}
	// The id of a deleted card revives its tombstone (and its extra).
	const write = studyWrite(snap, 'cards', cardRow(card, extraOf(snap, 'cards', card.id)));
	if (write !== null) await pushStudy(workspaceId, [write]);
	return card;
}

/**
 * rowsOfCards expands card ids to every stored row they stand for: the
 * unmerged duplicates of the card (same `cardKey`) and, for a vocab card,
 * its stored companion cards (sentence, writing, tone of the same word).
 * Deleting or moving only the merged survivor would let a duplicate or a
 * companion resurface in the old place.
 */
function rowsOfCards(
	all: readonly StudyCard[],
	ids: readonly string[],
): StudyCard[] {
	const wanted = new Set(ids);
	const picked = all.filter((card) => wanted.has(card.id));
	const keys = new Set(
		picked.map((card) => cardKey(card.kind, card.entryId, card.sentenceId)),
	);
	const vocabEntries = new Set(
		picked.filter((card) => card.kind === 'vocab').map((card) => card.entryId),
	);
	return all.filter(
		(card) =>
			wanted.has(card.id) ||
			keys.has(cardKey(card.kind, card.entryId, card.sentenceId)) ||
			(card.kind !== 'vocab' && vocabEntries.has(card.entryId)),
	);
}

/**
 * PartialCardsError is thrown when a multi-row write stops half way.
 * `rows` are what the caller needs to carry on: after deleteCards and
 * moveCards the rows that DID change (their previous state, for undo);
 * after restoreCards the rows still NOT written (for a retry).
 */
export class PartialCardsError extends ShownError {
	rows: StudyCard[];
	cause: unknown;

	constructor(message: string, rows: StudyCard[], cause: unknown) {
		super(message);
		this.name = 'PartialCardsError';
		this.rows = rows;
		this.cause = cause;
	}
}

/**
 * deleteCards tombstones the given cards (see rowsOfCards for what that
 * includes) and returns the removed rows, which restoreCards takes to
 * undo it. Companions and duplicates go first and the requested rows
 * last, so a failure half way leaves the card the user sees still
 * listed instead of hiding it behind live leftovers. A 404 means the row
 * is already gone (another tab): it is skipped and not reported as
 * removed. A failure throws PartialCardsError with the rows that did
 * land. Review events are not touched: reviews of a missing card are
 * ignored by scheduling and mastery, while EXP and streaks keep counting.
 */
export async function deleteCards(
	workspaceId: number,
	ids: readonly string[],
): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'deleteCards');
	if (ids.length === 0) return [];
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	const asked = new Set(ids);
	const rows = rowsOfCards(cards, ids);
	const ordered = [
		...rows.filter((row) => !asked.has(row.id)),
		...rows.filter((row) => asked.has(row.id)),
	];
	const removed: StudyCard[] = [];
	for (const row of ordered) {
		const write = studyDelete(snap, 'cards', row.id);
		if (write === null) continue;
		try {
			// Skipped: another tab deleted (or rewrote) the row since the read.
			if (await pushOptional(workspaceId, write)) removed.push(row);
		} catch (err) {
			throw new PartialCardsError(
				errorText(err, t('study.store.deleteFailed')),
				removed,
				err,
			);
		}
	}
	return removed;
}

/**
 * restoreCards writes removed (or moved) rows back; the server revives a
 * tombstoned key on PUT, so the card, its id and its reviews are all
 * back. Rows go in reverse of deletion order (the word before its
 * companions). With `onlyLive` a row whose card is no longer stored
 * (another tab deleted it since) is skipped instead of revived: undoing
 * a move must not resurrect a card deleted afterwards. A failure throws
 * PartialCardsError whose `rows` are the ones still to restore.
 */
export async function restoreCards(
	workspaceId: number,
	rows: readonly StudyCard[],
	opts: { onlyLive?: boolean } = {},
): Promise<void> {
	requireWorkspaceArg(workspaceId, 'restoreCards');
	let todo = [...rows].reverse();
	let snap: StudySnapshot;
	try {
		// Read first: a restore is stamped after the tombstone the server holds.
		const view = await planningView(workspaceId);
		snap = view.snapshot;
		const { cards } = view.data;
		if (opts.onlyLive === true) {
			const live = new Set(cards.map((card) => card.id));
			todo = todo.filter((row) => live.has(row.id));
		}
	} catch (err) {
		throw new PartialCardsError(
			errorText(err, t('study.store.undoFailed')),
			[...rows],
			err,
		);
	}
	for (let i = 0; i < todo.length; i++) {
		try {
			const write = studyWrite(snap, 'cards', cardRow(todo[i], extraOf(snap, 'cards', todo[i].id)));
			if (write !== null) await pushStudy(workspaceId, [write]);
		} catch (err) {
			throw new PartialCardsError(
				errorText(err, t('study.store.undoFailed')),
				todo.slice(i).reverse(),
				err,
			);
		}
	}
}

/**
 * moveCards makes `deckId` the only deck of the given cards (their
 * duplicates and companions follow). Rows already only in that deck are
 * not rewritten. Returns the rows as they were before, for undo through
 * restoreCards (with `onlyLive`); a failure throws PartialCardsError with
 * the rows already moved. The deck must be General or a stored deck.
 */
export async function moveCards(
	workspaceId: number,
	ids: readonly string[],
	deckId: string,
): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'moveCards');
	if (deckId === '') throw new Error('choose a deck to move the cards to');
	if (ids.length === 0) return [];
	const { data: { cards, decks }, snapshot: snap } = await planningView(workspaceId);
	if (deckId !== GENERAL_DECK_ID && !decks.some((deck) => deck.id === deckId)) {
		// Only the general deck is implicit: any other target must exist.
		throw new Error(`deck "${deckId}" not found`);
	}
	const changed = rowsOfCards(cards, ids).filter(
		(row) => row.deckIds.length !== 1 || row.deckIds[0] !== deckId,
	);
	const moved: StudyCard[] = [];
	for (const row of changed) {
		try {
			const write = studyWrite(
				snap,
				'cards',
				cardRow({ ...row, deckIds: [deckId] }, extraOf(snap, 'cards', row.id)),
			);
			if (write !== null) await pushStudy(workspaceId, [write]);
			moved.push(row);
		} catch (err) {
			throw new PartialCardsError(
				errorText(err, t('study.store.moveFailed')),
				moved,
				err,
			);
		}
	}
	return moved;
}

/**
 * vocabRowsOf: every stored vocab row (duplicates included) of an entry.
 * skipKinds lives on them, so all of them are rewritten together.
 */
function vocabRowsOf(all: readonly StudyCard[], entryId: number): StudyCard[] {
	return all.filter((card) => card.kind === 'vocab' && card.entryId === entryId);
}

function withSkip(row: StudyCard, skipKinds: readonly StudyCardKind[]): StudyCard {
	const { skipKinds: _old, ...rest } = row;
	void _old;
	const clean = cleanSkipKinds(skipKinds);
	return clean.length === 0 ? rest : { ...rest, skipKinds: clean };
}

/** Writes new skipKinds to the entry's vocab rows; returns their previous state. */
async function rewriteSkips(
	workspaceId: number,
	snap: StudySnapshot,
	rows: readonly StudyCard[],
	next: (row: StudyCard) => StudyCardKind[],
): Promise<StudyCard[]> {
	const changed: StudyCard[] = [];
	for (const row of rows) {
		const updated = withSkip(row, next(row));
		if (JSON.stringify(updated.skipKinds ?? []) === JSON.stringify(row.skipKinds ?? [])) continue;
		try {
			const write = studyWrite(snap, 'cards', cardRow(updated, extraOf(snap, 'cards', row.id)));
			if (write !== null) await pushStudy(workspaceId, [write]);
			changed.push(row);
		} catch (err) {
			throw new PartialCardsError(
				errorText(err, t('study.store.updateFailed')),
				changed,
				err,
			);
		}
	}
	return changed;
}

function assertSkippable(kind: StudyCardKind): void {
	if (kind === 'vocab') throw new Error('the vocab card of a word cannot be skipped');
}

/**
 * skipKind switches one non-vocab kind off for a word (even before its
 * card exists): the kind joins `skipKinds` on the word's vocab row(s), so
 * lazy creation does not bring the card back. Returns the previous vocab
 * rows for undo through restoreCards. A word without a vocab card has
 * nowhere to keep the switch: that is an error.
 */
export async function skipKind(
	workspaceId: number,
	entryId: number,
	kind: StudyCardKind,
): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'skipKind');
	assertSkippable(kind);
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	const rows = vocabRowsOf(cards, entryId);
	if (rows.length === 0) throw new Error('this word has no vocab card to hold the setting');
	return rewriteSkips(workspaceId, snap, rows, (row) => [...(row.skipKinds ?? []), kind]);
}

/** unskipKind removes a kind from the word's `skipKinds`; returns the previous rows for undo. */
export async function unskipKind(
	workspaceId: number,
	entryId: number,
	kind: StudyCardKind,
): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'unskipKind');
	assertSkippable(kind);
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	const rows = vocabRowsOf(cards, entryId);
	if (rows.length === 0) throw new Error('this word has no vocab card to hold the setting');
	return rewriteSkips(workspaceId, snap, rows, (row) =>
		(row.skipKinds ?? []).filter((skipped) => skipped !== kind),
	);
}

/**
 * dropSiblingCards removes one non-vocab card (and its stored duplicates)
 * of a word without removing the word: the kinds join the word's vocab
 * `skipKinds` first, then the rows are tombstoned. Returns the previous
 * rows (vocab rows and siblings) for restoreCards, which brings both
 * back; a sibling with no vocab row is just tombstoned (nothing would
 * recreate it). A vocab id is an error (use deleteCards). A failure
 * throws PartialCardsError with the rows that did change.
 */
export async function dropSiblingCards(
	workspaceId: number,
	ids: readonly string[],
): Promise<StudyCard[]> {
	requireWorkspaceArg(workspaceId, 'dropSiblingCards');
	if (ids.length === 0) return [];
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	const asked = cards.filter((card) => ids.includes(card.id));
	if (asked.some((card) => card.kind === 'vocab')) {
		throw new Error('only the other cards of a word can be removed on their own');
	}
	const keys = new Set(
		asked.map((card) => cardKey(card.kind, card.entryId, card.sentenceId)),
	);
	const siblings = cards.filter(
		(card) =>
			card.kind !== 'vocab' &&
			keys.has(cardKey(card.kind, card.entryId, card.sentenceId)),
	);
	const kindsByEntry = new Map<number, StudyCardKind[]>();
	for (const sibling of siblings) {
		kindsByEntry.set(sibling.entryId, [
			...(kindsByEntry.get(sibling.entryId) ?? []),
			sibling.kind,
		]);
	}
	const previous: StudyCard[] = [];
	for (const [entryId, kinds] of kindsByEntry) {
		const rows = vocabRowsOf(cards, entryId);
		try {
			previous.push(
				...(await rewriteSkips(workspaceId, snap, rows, (row) => [
					...(row.skipKinds ?? []),
					...kinds,
				])),
			);
		} catch (err) {
			if (err instanceof PartialCardsError) {
				throw new PartialCardsError(err.text, [...previous, ...err.rows], err.cause);
			}
			throw err;
		}
	}
	for (const row of siblings) {
		const write = studyDelete(snap, 'cards', row.id);
		if (write === null) continue;
		try {
			if (await pushOptional(workspaceId, write)) previous.push(row);
		} catch (err) {
			throw new PartialCardsError(
				errorText(err, t('study.store.removeFailed')),
				previous,
				err,
			);
		}
	}
	return previous;
}

