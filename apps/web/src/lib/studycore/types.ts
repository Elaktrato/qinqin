// The study layer's persistent shapes. Deck and card definitions live in
// typed study rows (docs/contracts/study/: decks and cards); review history and scheduling are separate (events, never
// stored schedules).

import type { ParsedGoals } from '$lib/goals/goals';
import type { DeckSettings } from './deckSettings';
import type { FsrsState } from './fsrsParams';
import type { GrammarRun } from './grammarRuns';
import type { KnownBatch } from './knownMarks';
import type { LimitPair } from './limits';
import type { SeenMilestone } from '$lib/milestones/seen';
import type { VacationPeriod } from './vacation';

/** Where an owned copy of a system deck came from (decks view, "Add to my decks"). */
export type DeckSource =
	| { type: 'level'; packId: string; level: string }
	| { type: 'frequency'; packId: string; size: number };

/** The implicit deck every card without another deck is in; it has no stored row. */
export const GENERAL_DECK_ID = 'general';

/** One user-created deck. The implicit `general` deck has no stored row. */
export interface Deck {
	id: string;
	name: string;
	createdAt: string;
	/** Set on a copy of a level or starter deck: "Copied from HSK 1". */
	source?: DeckSource;
}

export type StudyCardKind = 'vocab' | 'sentence' | 'writing' | 'tone' | 'reverse' | 'cloze';

export const CARD_KINDS: readonly StudyCardKind[] = [
	'vocab',
	'sentence',
	'writing',
	'tone',
	'reverse',
	'cloze'
];

/** Kinds a deck must switch on (deckcfg:) before they are planned. */
export type OptInKind = 'reverse' | 'cloze';

export const OPT_IN_KINDS: readonly OptInKind[] = ['reverse', 'cloze'];

/** Anki-style grades: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type ReviewGrade = 1 | 2 | 3 | 4;

/** Optional detail a review event carries beyond its grade. */
export interface ReviewMeta {
	tier?: 0 | 1 | 2;
	mistakes?: number;
	hints?: number;
	durationMs?: number;
}

/**
 * The payload of a `review` study event. Events stored before kinds
 * existed carry mode 'vocab' and no meta, and still parse.
 */
export interface ReviewPayload {
	cardId: string;
	mode: StudyCardKind;
	grade: ReviewGrade;
	meta?: ReviewMeta;
	/** The id of the review this one replaces (a changed grade, #131). */
	replaces?: string;
}

/**
 * One review as the append-only event log stores it. A card's schedule
 * is derived by replaying these events; it is never written anywhere.
 */
export interface ReviewEvent {
	id: string;
	workspaceId: number;
	device: string;
	ts: string;
	type: 'review';
	payload: ReviewPayload;
}

/** One study card. A card may belong to several decks at once. */
export interface StudyCard {
	id: string;
	kind: StudyCardKind;
	entryId: number;
	// The entry's written form as it looked when the card was added. It is
	// a snapshot: later analysis uses it without another entry fetch.
	// Cards added before this field existed have no snapshot.
	written?: string;
	// Set on cards created from a character entry (level sessions): no
	// sentence or tone companions, writing unlocks a learner day later.
	entryKind?: 'character';
	sentenceId?: number;
	/**
	 * Vocab rows only: non-vocab kinds the learner removed for this word, so
	 * lazy creation does not bring them back. Absent = nothing skipped.
	 */
	skipKinds?: StudyCardKind[];
	deckIds: string[];
	createdAt: string;
	/**
	 * The reading the card is pinned to (#346): its back shows only that
	 * reading's meanings (docs/contracts/senses). Stored as the row's
	 * `extra.reading`; set when the Starter words are added.
	 */
	reading?: string;
}

/** The parsed `limits:*` rows of one workspace. */
export interface StudyLimits {
	workspace: Partial<LimitPair> | null;
	decks: Record<string, Partial<LimitPair>>;
}

/** Everything a study page needs: the decks and the cards in them. */
export interface StudyData {
	decks: Deck[];
	cards: StudyCard[];
	/** The workspace's FSRS parameter sets; always set by the store. */
	fsrs?: FsrsState;
	/** Per-deck card type switches (`deckcfg:` rows), by deck id. */
	deckSettings?: Record<string, DeckSettings>;
	/** The user's vacation periods (user-global rows), absent when there are none. */
	vacations?: VacationPeriod[];
	/** The workspace's daily limit rows; absent without any. */
	limits?: StudyLimits;
	/** The workspace's `goals:workspace` row ('newer': a newer client's); absent without one. */
	goals?: Exclude<ParsedGoals, null>;
	/** Entries the learner marked known (live `known:` rows), absent without any. */
	known?: number[];
	/** The live marks a declaration wrote (#74), by entry; absent without any. */
	knownDeclared?: { entryId: number; createdAt: string; batch: KnownBatch }[];
	/** Seen milestones (live `milestone:` rows) by id, absent without any. */
	seenMilestones?: ReadonlyMap<string, SeenMilestone>;
	/** Tombstoned `milestone:` rows by id: their newest stamp (a re-dismiss is stamped after it). */
	milestoneTombstones?: ReadonlyMap<string, string>;
}

/**
 * StudyData plus the review history, with duplicate cards merged and
 * their reviews pointing at the surviving card (see canonical.ts).
 */
export interface StudyHistory extends StudyData {
	reviews: ReviewEvent[];
	/** The workspace's grammar lesson runs (#277), in replay order: EXP and the streak count them. */
	grammarRuns: GrammarRun[];
	/** How many stored duplicate cards were folded away. */
	merged: number;
}
