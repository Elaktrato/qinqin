// The card management controller shared by the Card manager on /study and
// the deck detail on /flashcards: serialized writes (an old undo can
// never overlap or follow a newer delete it would resurrect),
// PartialCardsError handling (the part that landed stays undoable), a
// single-slot undo that expires after 10 s and pauses while a write runs
// or the pointer rests on it. Pure and framework-free; components render
// its `state` and call its methods.

import { t, type MessageKey } from '$lib/i18n';
import { PartialCardsError } from './store';
import type { StudyCard, StudyCardKind } from './types';

export const UNDO_MS = 10000;

/** The store writes (store.ts), each naming its workspace (#174). */
export interface CardActionsDeps {
	deleteCards(workspaceId: number, ids: readonly string[]): Promise<StudyCard[]>;
	moveCards(workspaceId: number, ids: readonly string[], deckId: string): Promise<StudyCard[]>;
	restoreCards(workspaceId: number, rows: readonly StudyCard[], opts?: { onlyLive?: boolean }): Promise<void>;
	dropSiblingCards(workspaceId: number, ids: readonly string[]): Promise<StudyCard[]>;
	skipKind(workspaceId: number, entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
	unskipKind(workspaceId: number, entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
	/** Called after every action, failed ones included: show the stored state. */
	onchanged: () => void | Promise<void>;
	setTimer?: typeof setTimeout;
	clearTimer?: typeof clearTimeout;
}

export interface UndoSlot {
	/** The workspace the rows came from: an undo restores there, whatever is shown now. */
	workspaceId: number;
	text: string;
	rows: StudyCard[];
	/** A move-undo must not revive a card another tab deleted since. */
	onlyLive: boolean;
}

export interface CardActionsState {
	busy: boolean;
	error: string;
	undo: UndoSlot | null;
}

const KIND_LABEL: Partial<Record<StudyCardKind, MessageKey>> = {
	sentence: 'study.cardType.sentence',
	writing: 'study.cardType.writing',
	tone: 'study.cardType.tone',
	reverse: 'study.cardType.reverse',
	cloze: 'study.cardType.cloze'
};

function label(kind: StudyCardKind): string {
	const key = KIND_LABEL[kind];
	return key ? t(key) : kind;
}

/**
 * Every action names the workspace of the cards the user acted on (the
 * shown data's, captured at the click), never the one selected when the
 * write runs (#174).
 */
export interface CardActions {
	remove(workspaceId: number, ids: string[]): Promise<void>;
	move(workspaceId: number, ids: string[], deckId: string, deckName: string): Promise<void>;
	/** Removes the non-vocab cards with these ids without removing their word. */
	dropKind(workspaceId: number, ids: string[]): Promise<void>;
	skip(workspaceId: number, entryId: number, kind: StudyCardKind): Promise<void>;
	unskip(workspaceId: number, entryId: number, kind: StudyCardKind): Promise<void>;
	undo(): Promise<void>;
	state: { subscribe(fn: (s: CardActionsState) => void): () => void };
	pauseTimer(): void;
	resumeTimer(): void;
	destroy(): void;
}

export function createCardActions(deps: CardActionsDeps): CardActions {
	const setTimer = deps.setTimer ?? setTimeout;
	const clearTimer = deps.clearTimer ?? clearTimeout;
	let state: CardActionsState = { busy: false, error: '', undo: null };
	let pending = 0;
	let destroyed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Writes run one after another.
	let chain: Promise<unknown> = Promise.resolve();
	const listeners = new Set<(s: CardActionsState) => void>();

	function set(patch: Partial<CardActionsState>): void {
		state = { ...state, ...patch };
		for (const listener of [...listeners]) listener(state);
	}

	function stopTimer(): void {
		clearTimer(timer);
		timer = undefined;
	}

	function startTimer(): void {
		stopTimer();
		if (destroyed) return;
		timer = setTimer(() => {
			timer = undefined;
			// Never expire under a running write.
			if (pending > 0) startTimer();
			else set({ undo: null });
		}, UNDO_MS);
	}

	function offerUndo(slot: UndoSlot): void {
		set({ undo: slot });
		startTimer();
	}

	function run(action: () => Promise<void>): Promise<void> {
		const task = chain.then(async () => {
			pending += 1;
			set({ busy: true, error: '' });
			try {
				await action();
			} catch (err) {
				set({ error: err instanceof Error && err.message ? err.message : t('study.actions.failed') });
			} finally {
				// A failed write may still have landed: always show the stored state.
				try {
					await deps.onchanged();
				} finally {
					pending -= 1;
					set({ busy: pending > 0 });
				}
			}
		});
		chain = task.catch(() => undefined);
		return task;
	}

	/** Runs a row-changing write; whatever landed stays undoable, even on failure. */
	async function changing(
		workspaceId: number,
		write: () => Promise<StudyCard[]>,
		text: string,
		onlyLive: boolean
	): Promise<void> {
		let rows: StudyCard[];
		let failure: unknown = null;
		try {
			rows = await write();
		} catch (err) {
			if (!(err instanceof PartialCardsError)) throw err;
			rows = err.rows;
			failure = err;
		}
		if (rows.length > 0) offerUndo({ workspaceId, text, rows, onlyLive });
		if (failure !== null) throw failure;
	}

	return {
		remove: (workspaceId, ids) =>
			run(() =>
				changing(
					workspaceId,
					() => deps.deleteCards(workspaceId, ids),
					t('study.actions.deleted', { count: ids.length }),
					false
				)
			),
		move: (workspaceId, ids, deckId, deckName) =>
			run(() =>
				changing(
					workspaceId,
					() => deps.moveCards(workspaceId, ids, deckId),
					t('study.actions.moved', { count: ids.length, deck: deckName }),
					true
				)
			),
		dropKind: (workspaceId, ids) =>
			run(() =>
				changing(
					workspaceId,
					() => deps.dropSiblingCards(workspaceId, ids),
					t('study.actions.removed', { count: ids.length }),
					false
				)
			),
		skip: (workspaceId, entryId, kind) =>
			run(() =>
				changing(
					workspaceId,
					() => deps.skipKind(workspaceId, entryId, kind),
					t('study.actions.kindOff', { kind: label(kind) }),
					false
				)
			),
		unskip: (workspaceId, entryId, kind) =>
			run(() =>
				changing(
					workspaceId,
					() => deps.unskipKind(workspaceId, entryId, kind),
					t('study.actions.kindOn', { kind: label(kind) }),
					false
				)
			),
		undo: async () => {
			if (state.undo === null || pending > 0) return;
			stopTimer();
			await run(async () => {
				const slot = state.undo;
				if (slot === null) return;
				try {
					await deps.restoreCards(slot.workspaceId, slot.rows, { onlyLive: slot.onlyLive });
					// Cleared only after it worked, so a failed undo can be retried.
					set({ undo: null });
				} catch (err) {
					if (err instanceof PartialCardsError) set({ undo: { ...slot, rows: err.rows } });
					startTimer();
					throw err;
				}
			});
		},
		state: {
			subscribe(fn) {
				listeners.add(fn);
				fn(state);
				return () => {
					listeners.delete(fn);
				};
			}
		},
		pauseTimer: stopTimer,
		resumeTimer() {
			if (state.undo !== null) startTimer();
		},
		destroy() {
			destroyed = true;
			stopTimer();
			listeners.clear();
		}
	};
}
