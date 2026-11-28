// What a drill gives the Practice area (docs/contracts/drills/README.md, "Adding a drill"): its words, the languages
// it applies to, the items the learner can practise now, and the component that asks one item. The framework does
// the rest: the list, the rounds, the events, the schedules and the counting.

import type { Component } from 'svelte';
import type { Session } from '$lib/context/session.svelte';
import type { StudyHistory, ReviewGrade } from '$lib/studycore/types';
import type { Workspace } from '$lib/api/types';
import type { DrillAnswer, DrillStates } from '$lib/studycore/drills';

/** One item a drill can ask: its item key and whatever the drill's question needs. */
export interface DrillItem<Data = unknown> {
	key: string;
	data?: Data;
}

/** What a drill's items are built from. */
export interface DrillContext {
	session: Session;
	workspace: Workspace;
	/** The workspace's study history (decks, cards, reviews, drill answers). */
	history: StudyHistory;
}

/** What a question reports when the learner has answered. */
export interface DrillAnswerInput {
	/** The drill's mode (direction) of this question: the id pattern. */
	mode: string;
	grade: ReviewGrade;
}

/**
 * The props of a drill's question. The component is not remounted between items: it gets the next `item` and resets
 * its own state, so a typed answer field can keep focus (and the phone keyboard stays up). It calls `onAnswer` once
 * per item, shows its own feedback, and may call `onNext` (Enter in its field); the round shows a Next button too.
 */
export interface DrillQuestionProps {
	item: DrillItem;
	/** Whether this item is answered (the answer is recorded). */
	answered: boolean;
	onAnswer: (answer: DrillAnswerInput) => void;
	onNext: () => void;
}

/**
 * The props of a drill's overview on the Practice list (the tone-pair grid): its candidate items, its own answers
 * in replay order, every item's state and the instant the list was worked out at.
 */
export interface DrillOverviewProps {
	drill: DrillDef;
	items: readonly DrillItem[];
	answers: readonly DrillAnswer[];
	states: DrillStates;
	now: number;
}

export interface DrillDef {
	/** The drill id (`lib/studycore/drills.ts`, DRILL_IDS). */
	id: string;
	/** The title in the list and on a round (catalogue text, read when shown). */
	readonly title: string;
	readonly description: string;
	appliesTo: (language: string) => boolean;
	/** The items the learner can practise now, in the order new ones are introduced. */
	items: (ctx: DrillContext) => Promise<DrillItem[]>;
	/** A short name of an item for the round's summary (no reading unless through the romanisation settings). */
	label: (item: DrillItem) => string;
	question: Component<DrillQuestionProps>;
	/** Optional: what the Practice list shows under the drill (its own overview, such as the tone-pair grid). */
	overview?: Component<DrillOverviewProps>;
}

/** One question of a round. */
export interface RoundEntry {
	drill: string;
	item: DrillItem;
}
