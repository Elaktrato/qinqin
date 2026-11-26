// The trainer's progress: derived from the workspace's `script` events, never stored (spec 2026-11-26). One
// Leitner-style box per item. It is not FSRS and not a flashcard: the study queue never sees it.

import { parseScriptEvent } from './events';
import type { ScriptItem } from './types';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** The wait after an answer, by the box the item is in now (box 0: asked again soon). */
export const INTERVALS: readonly number[] = [MINUTE, 10 * MINUTE, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
export const MAX_BOX = INTERVALS.length - 1;
/** From this box on an item counts as known. */
export const KNOWN_BOX = 3;

export interface ItemState {
	box: number;
	correct: number;
	wrong: number;
	/** Epoch milliseconds of the last answer and of the time the item is due again. */
	lastAt: number;
	dueAt: number;
}

/**
 * applyAnswer is one answer. A wrong one sends the item to box 0. A correct one promotes it by one box, but
 * only when it was due (or new): asking the same item twice in one sitting must not climb the boxes.
 */
export function applyAnswer(state: ItemState | undefined, ok: boolean, at: number): ItemState {
	const prev = state ?? { box: 0, correct: 0, wrong: 0, lastAt: at, dueAt: at };
	if (!ok) return { ...prev, box: 0, wrong: prev.wrong + 1, lastAt: at, dueAt: at + INTERVALS[0] };
	const fresh = state === undefined;
	if (fresh || at >= prev.dueAt) {
		const box = Math.min(MAX_BOX, prev.box + 1);
		return { ...prev, box, correct: prev.correct + 1, lastAt: at, dueAt: at + INTERVALS[box] };
	}
	return { ...prev, correct: prev.correct + 1, lastAt: at };
}

/** deriveProgress replays the `script` events in time order (the log's order is not trusted). */
export function deriveProgress(events: readonly { type: string; ts: string; payload: unknown; id?: string }[]): Map<string, ItemState> {
	const answers = events.flatMap((e) => {
		const a = parseScriptEvent(e);
		return a === null ? [] : [{ a, id: e.id ?? '' }];
	});
	answers.sort((x, y) => x.a.at - y.a.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
	const map = new Map<string, ItemState>();
	for (const { a } of answers) map.set(a.item, applyAnswer(map.get(a.item), a.ok, a.at));
	return map;
}

export function isKnown(state: ItemState | undefined): boolean {
	return state !== undefined && state.box >= KNOWN_BOX;
}

export interface Summary {
	total: number;
	known: number;
	/** Seen, not known yet. */
	learning: number;
	unseen: number;
	/** Seen and due now. */
	due: number;
}

export function isDue(state: ItemState | undefined, now: number): boolean {
	return state !== undefined && state.dueAt <= now;
}

/** summarise counts a chart's items by their state. */
export function summarise(items: readonly ScriptItem[], map: ReadonlyMap<string, ItemState>, now: number): Summary {
	const out: Summary = { total: items.length, known: 0, learning: 0, unseen: 0, due: 0 };
	for (const item of items) {
		const s = map.get(item.id);
		if (s === undefined) out.unseen++;
		else if (isKnown(s)) out.known++;
		else out.learning++;
		if (isDue(s, now)) out.due++;
	}
	return out;
}
