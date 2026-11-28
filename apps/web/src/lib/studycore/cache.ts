// The study cache (#193): one per session, a slot per workspace holding the
// rows the server sent (readModel.ts StudyRows: raw rows with their
// last-write-wins stamps, tombstones and what this version cannot read). The
// merged history, the raw data and a write's snapshot are views of a slot;
// writes plan against it and update it in place.
//
// A slot older than `freshMs` is refreshed with a delta round from its cursor
// (one page in the usual case), with a full round when its last full round is
// older than `fullMs` (the service worker keeps full rounds for offline study)
// or the cursor expired (410). A held slot is served at once and refreshed in
// the background (stale-while-revalidate, #290); the listeners hear when the
// refresh changed rows. Only a first load, `force`, `full`, a slot marked
// stale and a `current` read (a write plans against the newest rows) wait. A round's `until` is the server clock truncated
// to the second, so a row stamped in that second comes next round: while
// anything listens, each round a reader or writer caused is followed by one
// delta round `followUpMs` later, and a round that changed rows tells the
// listeners (docs/contracts/sync/, rounds and cursors).
//
// A plain class with its dependencies injected; data.ts creates the session's
// instance and clears it at the session end (#173). #196 moves that instance
// into the per-session app context.

import { ApiError } from '$lib/api/client';
import type { KeyedRow } from '$lib/sync/keyed';
import {
	copyRows,
	sameContent,
	emptyRows,
	keyedSlot,
	mergeRows,
	newestOf,
	putKeyed,
	putTyped,
	viewOf,
	type StudyRows,
	type StudyView
} from './readModel';
import { identityOf, studyKey, type StudyCollection, type StudyRow } from './rows';
import type { StudyRound } from './sync/pull';

export const STUDY_FRESH_MS = 8_000;
export const STUDY_FULL_ROUND_MS = 5 * 60_000;
export const STUDY_FOLLOW_UP_MS = 1_250;

export interface StudyCacheDeps {
	/** One round of a workspace: from scratch, or a delta from `since`. */
	pull: (workspaceId: number, since?: string) => Promise<StudyRound>;
	now: () => number;
	/** The session's epoch: it moves when the session ends, and an answer that arrives after it moved is not stored. */
	epoch: () => number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
	freshMs?: number;
	fullMs?: number;
	followUpMs?: number;
	/** Called after every stored round with its view (the unreadable report). */
	onRound?: (workspaceId: number, view: StudyView, full: boolean) => void;
	/** A refresh of a loaded slot failed and its held rows were served instead (the quiet notice). */
	onRefreshFailed?: (workspaceId: number, err: unknown) => void;
}

interface Slot {
	rows: StudyRows | null;
	cursor: string | null;
	/** When the last round was read (the clock of `now`). */
	readAt: number;
	fullAt: number;
	pages: number;
	stale: boolean;
	/** Bumped by every markStale: a round clears `stale` only when no mark came after it started. */
	staleMarks: number;
	/** Whether the round in flight is a full one. */
	inFlightFull: boolean;
	/** Bumped by every change: the memoised view follows it. */
	version: number;
	view: { version: number; value: StudyView } | null;
	inFlight: Promise<StudyView> | null;
	/** Keys written in place while a full round runs: kept over the round when newer. */
	writtenDuringRound: Set<string> | null;
	followUp: unknown;
}

type Kind = 'full' | 'delta';

export class StudyCache {
	readonly #deps: StudyCacheDeps;
	readonly #slots = new Map<number, Slot>();
	readonly #listeners = new Set<(workspaceId: number) => void>();
	/** Bumped by clear: a round started before it is not stored. */
	#generation = 0;

	constructor(deps: StudyCacheDeps) {
		this.#deps = deps;
	}

	get #freshMs(): number {
		return this.#deps.freshMs ?? STUDY_FRESH_MS;
	}

	/**
	 * view: the slot's view, refreshed by the rules above. A loaded slot answers
	 * at once with its rows and refreshes in the background when it is older
	 * than the window. `current` waits for that refresh (a write's planning
	 * view); `force` reads a delta now (a widget's "Try again") and fails when it
	 * fails; `full` reads a full round (offline preparation). A failed refresh of
	 * a loaded slot otherwise serves the rows it holds (offline, the delta is not
	 * in the worker's copy) and is reported to `onRefreshFailed`.
	 */
	async view(workspaceId: number, opts: { force?: boolean; full?: boolean; current?: boolean } = {}): Promise<StudyView> {
		const slot = this.#slot(workspaceId);
		const now = this.#deps.now();
		const generation = this.#generation;
		const fresh = now - slot.readAt < this.#freshMs;
		const waits = slot.rows === null || opts.force === true || opts.full === true || slot.stale;
		if (!waits && (fresh || opts.current !== true)) {
			if (!fresh && slot.inFlight === null) {
				// Stale-while-revalidate: the held rows now, the refresh behind them.
				this.#round(workspaceId, slot, this.#kindFor(slot, now), true).catch((err: unknown) => this.#refreshFailed(workspaceId, err, generation));
			}
			return this.#viewOf(slot);
		}
		const loaded = slot.rows !== null;
		// Every reader of a loaded slot gets the rows held when the refresh fails, joining or not.
		const held = (run: Promise<StudyView>): Promise<StudyView> =>
			!loaded || opts.force === true || opts.full === true
				? run
				: run.catch((err: unknown) => {
						this.#refreshFailed(workspaceId, err, generation);
						return this.#viewOf(slot);
					});
		if (slot.inFlight !== null) {
			// A full read waits for a delta in flight, then reads its own full round.
			if (opts.full === true && !slot.inFlightFull) {
				const after = (): Promise<StudyView> => this.view(workspaceId, opts);
				return slot.inFlight.then(after, after);
			}
			return held(slot.inFlight);
		}
		return held(this.#round(workspaceId, slot, opts.full === true ? 'full' : this.#kindFor(slot, now), true));
	}

	#kindFor(slot: Slot, now: number): Kind {
		return slot.rows === null || slot.cursor === null || now - slot.fullAt >= (this.#deps.fullMs ?? STUDY_FULL_ROUND_MS) ? 'full' : 'delta';
	}

	/** A refresh started before a clear (the session end) reports nothing. */
	#refreshFailed(workspaceId: number, err: unknown, generation: number): void {
		if (generation === this.#generation) this.#deps.onRefreshFailed?.(workspaceId, err);
	}

	/** peek: the slot's view without reading anything, or null when the workspace is not loaded. */
	peek(workspaceId: number): StudyView | null {
		const slot = this.#slots.get(workspaceId);
		return slot === undefined || slot.rows === null ? null : this.#viewOf(slot);
	}

	/** loadedViews: every loaded slot's view (a user-global keyed row is in each). */
	loadedViews(): StudyView[] {
		return [...this.#slots.values()].filter((slot) => slot.rows !== null).map((slot) => this.#viewOf(slot));
	}

	/** pages: how many pages the workspace's last full round took (the offline receipt counts them). */
	pages(workspaceId: number): number {
		return this.#slots.get(workspaceId)?.pages ?? 0;
	}

	/** keyedStamp: the newest stamp a loaded slot holds for a keyed row (workspace null: user-global), if any. */
	keyedStamp(workspaceId: number | null, key: string): string | undefined {
		const targets = workspaceId === null ? [...this.#slots.values()] : [this.#slots.get(workspaceId)];
		for (const slot of targets) {
			const row = slot?.rows?.keyed.get(keyedSlot(key, workspaceId === null));
			if (row !== undefined) return newestOf([row.updatedAt, row.deletedAt]);
		}
		return undefined;
	}

	/** applyTyped holds typed rows this tab wrote, as the server now holds them. */
	applyTyped(workspaceId: number, collection: StudyCollection, rows: readonly StudyRow[]): void {
		const slot = this.#slots.get(workspaceId);
		if (slot !== undefined && slot.rows !== null) {
			for (const row of rows) {
				putTyped(slot.rows, collection, row);
				slot.writtenDuringRound?.add(studyKey(collection, identityOf(collection, row)));
			}
			slot.version++;
		}
		this.#notify(workspaceId);
	}

	/** applyKeyed holds keyed rows this tab wrote; a user-global row (workspace null) goes into every slot. */
	applyKeyed(workspaceId: number | null, rows: readonly KeyedRow[]): void {
		const targets = workspaceId === null ? [...this.#slots.values()] : [this.#slots.get(workspaceId)];
		for (const slot of targets) {
			if (slot === undefined || slot.rows === null) continue;
			for (const row of rows) {
				putKeyed(slot.rows, row);
				slot.writtenDuringRound?.add(keyedSlot(row.key, row.workspaceId === null));
			}
			slot.version++;
		}
		this.#notify(workspaceId ?? 0);
	}

	/**
	 * markStale: a write failed or the server skipped one (it holds newer rows):
	 * the next use of the workspace (every workspace for null) reads a delta first.
	 */
	markStale(workspaceId: number | null): void {
		const targets = workspaceId === null ? [...this.#slots.values()] : [this.#slots.get(workspaceId)];
		for (const slot of targets) {
			if (slot === undefined) continue;
			slot.stale = true;
			slot.staleMarks++;
		}
		this.#notify(workspaceId ?? 0);
	}

	/** onChange: called with the workspace whose rows changed (0: user-global rows); returns the unsubscribe. */
	onChange(listener: (workspaceId: number) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** clear forgets every slot and timer (the session end); a round in flight is not stored. */
	clear(): void {
		this.#generation++;
		for (const slot of this.#slots.values()) {
			if (slot.followUp !== undefined) this.#deps.clearTimer?.(slot.followUp);
		}
		this.#slots.clear();
	}

	#slot(workspaceId: number): Slot {
		let slot = this.#slots.get(workspaceId);
		if (slot === undefined) {
			slot = {
				rows: null,
				cursor: null,
				readAt: 0,
				fullAt: 0,
				pages: 0,
				stale: false,
				staleMarks: 0,
				inFlightFull: false,
				version: 0,
				view: null,
				inFlight: null,
				writtenDuringRound: null,
				followUp: undefined
			};
			this.#slots.set(workspaceId, slot);
		}
		return slot;
	}

	#viewOf(slot: Slot): StudyView {
		if (slot.view === null || slot.view.version !== slot.version) {
			slot.view = { version: slot.version, value: viewOf(slot.rows ?? emptyRows()) };
		}
		return slot.view.value;
	}

	#notify(workspaceId: number): void {
		for (const listener of [...this.#listeners]) listener(workspaceId);
	}

	#round(workspaceId: number, slot: Slot, kind: Kind, followUp: boolean): Promise<StudyView> {
		const generation = this.#generation;
		const epoch = this.#deps.epoch();
		const current = (): boolean => generation === this.#generation && epoch === this.#deps.epoch();
		const marks = slot.staleMarks;
		let full = kind === 'full';
		if (full) slot.writtenDuringRound = new Set();
		const run = (async (): Promise<StudyView> => {
			let round: StudyRound;
			try {
				round = await this.#deps.pull(workspaceId, full ? undefined : (slot.cursor ?? undefined));
			} catch (err) {
				if (full || !(err instanceof ApiError && err.status === 410)) throw err;
				// The cursor expired: read the workspace from scratch.
				full = true;
				if (current()) {
					slot.writtenDuringRound = new Set();
					slot.inFlightFull = true;
				}
				round = await this.#deps.pull(workspaceId);
			}
			const loaded = slot.rows !== null;
			let rows: StudyRows;
			let changed: boolean;
			if (full) {
				rows = emptyRows();
				mergeRows(rows, round.collections, workspaceId);
				if (slot.rows !== null) keepLocalWrites(rows, slot.rows, slot.writtenDuringRound ?? new Set());
				changed = slot.rows === null || !sameRows(rows, slot.rows);
			} else {
				rows = copyRows(slot.rows ?? emptyRows());
				changed = mergeRows(rows, round.collections, workspaceId);
			}
			if (!current()) return viewOf(rows);
			slot.rows = rows;
			slot.cursor = round.cursor;
			slot.readAt = this.#deps.now();
			if (slot.staleMarks === marks) slot.stale = false;
			if (full) {
				slot.fullAt = slot.readAt;
				slot.pages = round.pages;
			}
			if (changed) slot.version++;
			const view = this.#viewOf(slot);
			this.#deps.onRound?.(workspaceId, view, full);
			if (changed && loaded) this.#notify(workspaceId);
			if (followUp) this.#scheduleFollowUp(workspaceId, slot);
			return view;
		})();
		slot.inFlight = run;
		slot.inFlightFull = full;
		const done = (): void => {
			if (slot.inFlight === run) {
				slot.inFlight = null;
				slot.inFlightFull = false;
			}
			if (full && current()) slot.writtenDuringRound = null;
		};
		run.then(done, done);
		return run;
	}

	#scheduleFollowUp(workspaceId: number, slot: Slot): void {
		const setTimer = this.#deps.setTimer;
		if (setTimer === undefined || this.#listeners.size === 0) return;
		if (slot.followUp !== undefined) this.#deps.clearTimer?.(slot.followUp);
		const generation = this.#generation;
		slot.followUp = setTimer(() => {
			slot.followUp = undefined;
			if (generation !== this.#generation || slot.rows === null || slot.inFlight !== null) return;
			// A follow-up is a delta that schedules no other; its failure is not anyone's error.
			this.#round(workspaceId, slot, 'delta', false).catch(() => undefined);
		}, this.#deps.followUpMs ?? STUDY_FOLLOW_UP_MS);
	}
}

/** createStudyCache builds the cache (data.ts makes the session's one). */
export function createStudyCache(deps: StudyCacheDeps): StudyCache {
	return new StudyCache(deps);
}

/** keepLocalWrites puts back into a fresh full round the rows this tab wrote while it ran, when newer. */
function keepLocalWrites(fresh: StudyRows, held: StudyRows, keys: ReadonlySet<string>): void {
	for (const key of keys) {
		const typed = held.typed.get(key);
		const unreadable = fresh.unreadable.get(key);
		// A row this version cannot read that is not older than the write stays protected (record 0002).
		if (unreadable !== undefined) {
			const mine = typed ?? held.keyed.get(key);
			const stamp = mine === undefined ? undefined : newestOf([mine.updatedAt, mine.deletedAt]);
			if (unreadable.stamp === undefined || stamp === undefined || Date.parse(unreadable.stamp) >= Date.parse(stamp)) continue;
		}
		if (typed !== undefined) {
			const theirs = fresh.typed.get(key);
			if (theirs === undefined || stampAfterOrSame(typed, theirs)) {
				fresh.unreadable.delete(key);
				fresh.typed.set(key, typed);
			}
			continue;
		}
		const keyed = held.keyed.get(key);
		if (keyed !== undefined) {
			const theirs = fresh.keyed.get(key);
			if (theirs === undefined || stampAfterOrSame(keyed, theirs)) {
				fresh.unreadable.delete(key);
				fresh.keyed.set(key, keyed);
			}
		}
	}
}

function stampAfterOrSame(
	mine: { updatedAt: string; deletedAt: string | null },
	theirs: { updatedAt: string; deletedAt: string | null }
): boolean {
	const a = newestOf([mine.updatedAt, mine.deletedAt]);
	const b = newestOf([theirs.updatedAt, theirs.deletedAt]);
	return a === undefined || b === undefined || Date.parse(a) >= Date.parse(b);
}

function sameRows(a: StudyRows, b: StudyRows): boolean {
	const same = <V>(x: Map<string, V>, y: Map<string, V>): boolean =>
		x.size === y.size && [...x].every(([key, value]) => sameContent(value, y.get(key)));
	return same(a.typed, b.typed) && same(a.keyed, b.keyed) && same(a.unreadable, b.unreadable) && same(a.anonymous, b.anonymous);
}
