// The card management controller shared by the Card manager on /study and
// the deck detail on /p/flashcards: serialized writes (an old undo can
// never overlap or follow a newer delete it would resurrect),
// PartialCardsError handling (the part that landed stays undoable), a
// single-slot undo that expires after 10 s and pauses while a write runs
// or the pointer rests on it. Pure and framework-free; components render
// its `state` and call its methods.

import { PartialCardsError } from './store';
import type { StudyCard, StudyCardKind } from './types';

export const UNDO_MS = 10000;

export interface CardActionsDeps {
	deleteCards(ids: readonly string[]): Promise<StudyCard[]>;
	moveCards(ids: readonly string[], deckId: string): Promise<StudyCard[]>;
	restoreCards(rows: readonly StudyCard[], opts?: { onlyLive?: boolean }): Promise<void>;
	dropSiblingCards(ids: readonly string[]): Promise<StudyCard[]>;
	skipKind(entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
	unskipKind(entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
	/** Called after every action, failed ones included: show the stored state. */
	onchanged: () => void | Promise<void>;
	setTimer?: typeof setTimeout;
	clearTimer?: typeof clearTimeout;
}

export interface UndoSlot {
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

const KIND_LABEL: Partial<Record<StudyCardKind, string>> = {
	sentence: 'Word Salad',
	writing: 'Writing',
	tone: 'Tone',
	reverse: 'Reverse',
	cloze: 'Cloze'
};

function label(kind: StudyCardKind): string {
	return KIND_LABEL[kind] ?? kind;
}

export interface CardActions {
	remove(ids: string[]): Promise<void>;
	move(ids: string[], deckId: string, deckName: string): Promise<void>;
	/** Removes the non-vocab cards with these ids without removing their word. */
	dropKind(ids: string[]): Promise<void>;
	skip(entryId: number, kind: StudyCardKind): Promise<void>;
	unskip(entryId: number, kind: StudyCardKind): Promise<void>;
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
				set({ error: err instanceof Error && err.message ? err.message : 'That did not work.' });
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
		if (rows.length > 0) offerUndo({ text, rows, onlyLive });
		if (failure !== null) throw failure;
	}

	return {
		remove: (ids) =>
			run(() =>
				changing(
					() => deps.deleteCards(ids),
					ids.length === 1 ? 'Card deleted.' : `${ids.length} cards deleted.`,
					false
				)
			),
		move: (ids, deckId, deckName) =>
			run(() =>
				changing(
					() => deps.moveCards(ids, deckId),
					ids.length === 1 ? `Moved to ${deckName}.` : `Moved ${ids.length} cards to ${deckName}.`,
					true
				)
			),
		dropKind: (ids) =>
			run(() =>
				changing(
					() => deps.dropSiblingCards(ids),
					ids.length === 1 ? 'Card removed.' : `${ids.length} cards removed.`,
					false
				)
			),
		skip: (entryId, kind) =>
			run(() =>
				changing(() => deps.skipKind(entryId, kind), `${label(kind)} turned off for this word.`, false)
			),
		unskip: (entryId, kind) =>
			run(() =>
				changing(() => deps.unskipKind(entryId, kind), `${label(kind)} turned back on.`, false)
			),
		undo: async () => {
			if (state.undo === null || pending > 0) return;
			stopTimer();
			await run(async () => {
				const slot = state.undo;
				if (slot === null) return;
				try {
					await deps.restoreCards(slot.rows, { onlyLive: slot.onlyLive });
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
