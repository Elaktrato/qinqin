// Test builders for study data (docs/architecture/0005-test-conventions.md):
// cards, reviews and histories. A test that needs another variant passes
// overrides, or extends this module; it does not spell out a row literal of
// its own, so a change to a study row's shape changes this file only.

import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { scheduleFor } from '$lib/studycore/scheduler';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
import type { ReviewEvent, ReviewGrade, ReviewMeta, StudyCard, StudyCardKind, StudyHistory } from '$lib/studycore/types';

/** The default card creation instant. */
export const CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Drops keys whose value is undefined, so an absent optional field stays absent. */
function defined<T extends object>(o: T): T {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** A study card: vocab card 'c1' of entry 1 in the general deck unless overridden (an undefined override keeps the default). */
export function card(over: Partial<StudyCard> = {}): StudyCard {
	return { id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: CREATED_AT, ...defined(over) };
}

export interface ReviewSpec {
	cardId: string;
	ts: string;
	/** Default 3 (Good). Tests of invalid input may pass any number. */
	grade?: ReviewGrade | number;
	/** Default `${cardId}-${ts}`. */
	id?: string;
	/** Default 'vocab'. */
	mode?: StudyCardKind;
	/** Default 1. */
	workspaceId?: number;
	/** Default 'web'. */
	device?: string;
	meta?: ReviewMeta;
	replaces?: string;
}

/** A review event: a Good vocab review in workspace 1 unless overridden. */
export function review(spec: ReviewSpec): ReviewEvent {
	const { cardId, ts, grade = 3, id = `${cardId}-${ts}`, mode = 'vocab', workspaceId = 1, device = 'web', meta, replaces } = spec;
	return {
		id,
		workspaceId,
		device,
		ts,
		type: 'review',
		payload: defined({ cardId, mode, grade: grade as ReviewGrade, meta, replaces })
	};
}

/** A study history: no decks, cards, reviews or grammar runs, nothing merged, unless overridden. */
export function history(over: Partial<StudyHistory> = {}): StudyHistory {
	return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], ...over };
}

/** A ULID-shaped event id (26 characters by default) that sorts by n: prefix, then n zero-padded. */
export function eventId(n: number, prefix = '01JTEST', width = 26): string {
	return `${prefix}${String(n).padStart(width - prefix.length, '0')}`;
}

/**
 * A review history that makes a card strong (stability well above the
 * "learned" edge), built by answering Easy at every due date.
 */
export function strongReviews(cardId: string, start = '2025-01-01T00:00:00.000Z', n = 8): ReviewEvent[] {
	const events: ReviewEvent[] = [];
	let ts = start;
	for (let i = 0; i < n; i++) {
		events.push(review({ cardId, ts, grade: 4, id: `01JSTRONG${cardId}-${i}`, device: 'test' }));
		const schedule = scheduleFor(cardId, events, new Date(ts), DEFAULT_W, IDENTITY_CLOCK);
		ts = schedule?.due ?? ts;
	}
	return events;
}
