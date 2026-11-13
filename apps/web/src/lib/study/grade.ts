// The grade step of a study session, kept out of the Svelte page so both
// session modes are covered by tests. A deck session grades a real card
// directly. A level session may be looking at a virtual item: its card
// does not exist until the first grade, so the card is created first and
// the review is recorded against the real id addCard returns. A creation
// failure must leave the queue untouched and record nothing.

import { ApiError } from '../api/client';
import { GENERAL_DECK_ID } from './store';
import type { ReviewGrade, ReviewMeta, StudyCard, StudyCardKind } from './types';

/** One queue item as both session modes represent it. */
export interface GradeableItem {
	cardId: string;
	entryId: number;
	virtual: boolean;
	card: StudyCard | null;
	/** Kind of the card a virtual item creates; vocab when absent. */
	kind?: StudyCardKind;
	/** Sentence a virtual item's card is about; defaults to the entry's first. */
	sentenceId?: number;
}

/** The entry data a virtual item needs to create its card. */
export interface GradeEntry {
	written: string;
	sentences?: readonly { id: number }[];
}

/** The store write a virtual item needs; injected so tests stay pure. */
export type AddCard = (
	entryId: number,
	opts: {
		kind?: StudyCardKind;
		written?: string;
		sentenceId?: number;
		deckIds?: string[];
	}
) => Promise<StudyCard>;

/** The event append a graded item needs; injected for the same reason. */
export type RecordReview = (
	workspaceId: number,
	cardId: string,
	grade: ReviewGrade,
	mode: StudyCardKind,
	meta?: ReviewMeta
) => Promise<void>;

export interface GradeItemInput {
	item: GradeableItem;
	grade: ReviewGrade;
	workspaceId: number;
	/** Review mode; defaults to the card's (or virtual item's) kind. */
	mode?: StudyCardKind;
	meta?: ReviewMeta;
	/** Writes are workspace-scoped; a switch mid-grade must not happen. */
	currentWorkspaceId?: number | null;
	/** Required for virtual items; null means the entry is still loading. */
	entry?: GradeEntry | null;
	addCard: AddCard;
	recordReview: RecordReview;
}

export type GradeItemResult =
	| { ok: true; card: StudyCard; created: boolean }
	| { ok: false; error: string };

function message(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.message) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

/**
 * gradeItem performs one grade transaction:
 *
 * - a workspace mismatch refuses before any write;
 * - a virtual item creates its card first (with the entry's written
 *   snapshot, its first sentence, and General as the deck) and records
 *   the review against the returned real id;
 * - a real item records directly;
 * - a creation failure records nothing and reports the error, so the
 *   caller can leave the item in the queue.
 */
export async function gradeItem({
	item,
	grade,
	workspaceId,
	mode,
	meta,
	currentWorkspaceId,
	entry,
	addCard,
	recordReview
}: GradeItemInput): Promise<GradeItemResult> {
	if (currentWorkspaceId !== undefined && currentWorkspaceId !== workspaceId) {
		return {
			ok: false,
			error: 'The workspace changed. Start a new session to continue.'
		};
	}

	if (!item.virtual) {
		if (item.card === null) {
			return { ok: false, error: 'This card is no longer available.' };
		}
		await recordReview(workspaceId, item.card.id, grade, mode ?? item.card.kind, meta);
		return { ok: true, card: item.card, created: false };
	}

	if (entry === undefined || entry === null) {
		return { ok: false, error: 'This word is still loading. Try again.' };
	}

	const kind = item.kind ?? 'vocab';
	let card: StudyCard;
	try {
		card = await addCard(item.entryId, {
			kind,
			written: entry.written,
			sentenceId: item.sentenceId ?? entry.sentences?.[0]?.id,
			deckIds: [GENERAL_DECK_ID]
		});
	} catch (err) {
		return {
			ok: false,
			error: message(err, 'Could not add this word to your study cards.')
		};
	}

	await recordReview(workspaceId, card.id, grade, mode ?? kind, meta);
	return { ok: true, card, created: true };
}
