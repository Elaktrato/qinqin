// The highlights of the open book, with optimistic updates (the pattern of
// bookmarkList.svelte.ts). Every change shows at once and is rolled back
// when the server refuses it; results that arrive after the reader switched
// books are dropped (a sequence number per loaded book). The API is
// injected, so this is testable without a server.
//
// Edits are never dropped: requests for one highlight are sent one at a
// time, and edits made meanwhile are merged into one pending patch (the
// latest value per field wins) that is sent when the request in flight
// settles. Edits of a highlight whose add is still pending wait for the
// add and then go to its real id; a remove waits the same way.
import { ApiError } from '$lib/api/client';
import { HighlightOverlapError, type NewHighlight } from '$lib/api/library';
import { snippetAt } from './bookmarks';
import { apiErrorMessage } from './errors';
import { overlaps, type Highlight, type HighlightColor } from './highlights';

export type { NewHighlight };

export interface HighlightPatch {
	color?: HighlightColor;
	note?: string;
}

export interface HighlightApi {
	list(bookId: number): Promise<Highlight[]>;
	add(bookId: number, body: NewHighlight): Promise<Highlight>;
	update(bookId: number, id: number, patch: HighlightPatch): Promise<Highlight>;
	remove(bookId: number, id: number): Promise<void>;
}

/**
 * AddResult: the saved highlight, or a refusal. On an overlap `existingId`
 * names the saved highlight the span overlaps and `available` says whether
 * it is in `items` now (after one reload when it was not known locally), so
 * the caller can open its editor. Any other refusal sets `error`.
 */
export type AddResult =
	| { ok: true; highlight: Highlight }
	| { ok: false; existingId?: number; available?: boolean };

interface Pending {
	patch: HighlightPatch;
	/** Settle the update() calls merged into `patch`. */
	waiters: ((ok: boolean) => void)[];
	/** A remove is wanted: `removed` is what was shown. */
	remove: Highlight | null;
	removeWaiters: (() => void)[];
}

const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

const ANNOUNCE_RUNES = 40;

// Reading order: chapter, paragraph, start (the server's order).
const byPlace = (a: Highlight, b: Highlight) =>
	a.chapter - b.chapter || a.paragraph - b.paragraph || a.start - b.start || a.id - b.id;

const isEmpty = (patch: HighlightPatch) => patch.color === undefined && patch.note === undefined;

function settle(entry: Pending | undefined, ok: boolean): void {
	if (!entry) return;
	for (const waiter of entry.waiters) waiter(ok);
	for (const waiter of entry.removeWaiters) waiter();
	entry.waiters = [];
	entry.removeWaiters = [];
}

export class HighlightList {
	items = $state<Highlight[]>([]);
	bookId = $state<number | null>(null);
	loading = $state(false);
	loadError = $state('');
	/** The last failed change, shown inline. */
	error = $state('');
	/** For a polite live region: what the last change did. */
	announcement = $state('');
	/** Ids with a request in flight. */
	#busy = $state<ReadonlySet<number>>(new Set());

	#api: HighlightApi;
	#seq = 0;
	#nextTemp = -1;
	/** The last server-confirmed version of each saved highlight. */
	#server = new Map<number, Highlight>();
	/** Edits and removes waiting for the request in flight (or the add). */
	#queue = new Map<number, Pending>();
	/** Temporary id of a saved add -> its real id. */
	#alias = new Map<number, number>();
	/** Removed locally, delete not confirmed yet: a reload must not bring them back. */
	#removing = new Set<number>();

	constructor(api: HighlightApi) {
		this.#api = api;
	}

	/** The list is known: changes are possible. */
	get ready(): boolean {
		return this.bookId !== null && !this.loading && !this.loadError;
	}

	/** get finds a highlight by id; a temporary id keeps finding it once saved. */
	get(id: number): Highlight | null {
		const real = this.#real(id);
		return this.items.find((h) => h.id === real) ?? null;
	}

	/** busy: a request for this highlight is in flight (or it is not saved yet). */
	busy(id: number): boolean {
		const real = this.#real(id);
		return real < 0 || this.#busy.has(real);
	}

	async load(bookId: number): Promise<void> {
		const seq = ++this.#seq;
		this.#reset();
		this.bookId = bookId;
		this.items = [];
		this.loading = true;
		this.loadError = '';
		this.error = '';
		this.announcement = '';
		try {
			const list = await this.#api.list(bookId);
			if (seq !== this.#seq) return;
			for (const h of list) this.#server.set(h.id, h);
			this.items = [...list].sort(byPlace);
		} catch (err) {
			if (seq === this.#seq) this.loadError = apiErrorMessage(err, 'highlights');
		} finally {
			if (seq === this.#seq) this.loading = false;
		}
	}

	/**
	 * add saves a new highlight, shown at once. A span overlapping a known
	 * highlight is refused without asking the server; the server's overlap
	 * answer (409 with the existing id) is reported the same way.
	 */
	async add(body: NewHighlight): Promise<AddResult> {
		const bookId = this.bookId;
		if (bookId === null || !this.ready) return { ok: false };
		const known = overlaps(this.items, body.paragraph, body.start, body.end, body.chapter);
		if (known) return known.id > 0 ? { ok: false, existingId: known.id, available: true } : { ok: false };
		const seq = this.#seq;
		const now = new Date().toISOString();
		const temp: Highlight = {
			id: this.#nextTemp--,
			bookId,
			chapter: body.chapter,
			paragraph: body.paragraph,
			start: body.start,
			end: body.end,
			text: body.text,
			color: body.color,
			note: body.note ?? '',
			createdAt: now,
			updatedAt: now
		};
		this.items = [...this.items, temp].sort(byPlace);
		this.error = '';
		let saved: Highlight;
		try {
			saved = await this.#api.add(bookId, body);
		} catch (err) {
			if (seq !== this.#seq) return { ok: false };
			this.items = this.items.filter((h) => h.id !== temp.id);
			settle(this.#queue.get(temp.id), false);
			this.#queue.delete(temp.id);
			if (err instanceof HighlightOverlapError) return this.#overlapResult(bookId, seq, err.existingId);
			this.error = apiErrorMessage(err, 'highlightAdd');
			return { ok: false };
		}
		if (seq !== this.#seq) return { ok: false };
		this.#server.set(saved.id, saved);
		this.#alias.set(temp.id, saved.id);
		const pending = this.#queue.get(temp.id);
		this.#queue.delete(temp.id);
		const others = this.items.filter((h) => h.id !== temp.id && h.id !== saved.id);
		let shown = saved;
		if (pending?.remove) {
			// Removed before it was saved: delete it now.
			this.items = others;
			this.#removing.add(saved.id);
			pending.remove = shown;
		} else {
			shown = pending ? { ...saved, ...pending.patch } : saved;
			this.items = [...others, shown].sort(byPlace);
			this.announcement = `Highlight added: ${snippetAt(saved.text, ANNOUNCE_RUNES)}`;
		}
		if (pending) {
			this.#queue.set(saved.id, pending);
			void this.#pump(saved.id);
		}
		return { ok: true, highlight: shown };
	}

	/**
	 * update changes colour and/or note at once. While a request for the
	 * highlight is in flight (or its add is pending) the change waits and is
	 * merged with later ones. Resolves true once the server has it.
	 */
	update(id: number, patch: HighlightPatch): Promise<boolean> {
		const real = this.#real(id);
		const current = this.get(real);
		if (this.bookId === null || !current) return Promise.resolve(false);
		const changes: HighlightPatch = {};
		if (patch.color !== undefined && patch.color !== current.color) changes.color = patch.color;
		if (patch.note !== undefined && patch.note !== current.note) changes.note = patch.note;
		if (isEmpty(changes)) return Promise.resolve(true);
		this.#replace(real, { ...current, ...changes });
		this.error = '';
		const entry = this.#entry(real);
		entry.patch = { ...entry.patch, ...changes };
		const done = new Promise<boolean>((resolve) => entry.waiters.push(resolve));
		void this.#pump(real);
		return done;
	}

	/** remove hides the highlight at once and deletes it once nothing else for it is in flight. */
	remove(id: number): Promise<void> {
		const real = this.#real(id);
		const current = this.get(real);
		if (this.bookId === null || !current) return Promise.resolve();
		this.items = this.items.filter((h) => h.id !== real);
		this.error = '';
		const entry = this.#entry(real);
		// Edits not sent yet are moot.
		for (const waiter of entry.waiters) waiter(false);
		entry.waiters = [];
		entry.patch = {};
		entry.remove = current;
		this.#removing.add(real);
		const done = new Promise<void>((resolve) => entry.removeWaiters.push(resolve));
		void this.#pump(real);
		return done;
	}

	// Sends what is queued for a saved highlight unless a request for it is
	// in flight; runs again when that request settles.
	async #pump(id: number): Promise<void> {
		const bookId = this.bookId;
		if (id < 0 || bookId === null || this.#busy.has(id)) return;
		const entry = this.#queue.get(id);
		if (!entry) return;
		this.#queue.delete(id);
		if (entry.remove) return this.#sendRemove(bookId, id, entry, entry.remove);
		if (isEmpty(entry.patch)) return settle(entry, true);
		const seq = this.#seq;
		const patch = entry.patch;
		this.#mark(id, true);
		try {
			const saved = await this.#api.update(bookId, id, patch);
			if (seq !== this.#seq) return settle(entry, false);
			this.#server.set(id, saved);
			// Newer edits waiting in the queue stay shown.
			const newer = this.#queue.get(id)?.patch ?? {};
			if (this.items.some((h) => h.id === id)) this.#replace(id, { ...saved, ...newer });
			this.announcement = 'Highlight updated';
			settle(entry, true);
		} catch (err) {
			if (seq !== this.#seq) return settle(entry, false);
			if (isGone(err)) {
				this.items = this.items.filter((h) => h.id !== id);
				this.#server.delete(id);
				settle(this.#queue.get(id), false);
				this.#queue.delete(id);
				this.#removing.delete(id);
			} else {
				this.#revert(id, patch);
			}
			this.error = apiErrorMessage(err, 'highlight');
			settle(entry, false);
		} finally {
			if (seq === this.#seq) {
				this.#mark(id, false);
				void this.#pump(id);
			}
		}
	}

	async #sendRemove(bookId: number, id: number, entry: Pending, removed: Highlight): Promise<void> {
		const seq = this.#seq;
		this.#mark(id, true);
		let failed = false;
		try {
			await this.#api.remove(bookId, id);
		} catch (err) {
			// Already gone on the server: that is what was wanted.
			if (seq === this.#seq && !isGone(err)) {
				failed = true;
				const back = this.#server.get(id) ?? removed;
				if (!this.items.some((h) => h.id === id)) this.items = [...this.items, back].sort(byPlace);
				this.error = apiErrorMessage(err, 'highlight');
			}
		} finally {
			if (seq === this.#seq) {
				this.#mark(id, false);
				this.#removing.delete(id);
			}
		}
		if (seq === this.#seq && !failed) {
			this.#server.delete(id);
			this.announcement = `Highlight removed: ${snippetAt(removed.text, ANNOUNCE_RUNES)}`;
		}
		settle(entry, !failed);
		if (seq === this.#seq) void this.#pump(id);
	}

	// A failed patch's fields go back to the last confirmed values, except
	// those a queued edit changes again.
	#revert(id: number, failed: HighlightPatch): void {
		const confirmed = this.#server.get(id);
		const shown = this.items.find((h) => h.id === id);
		if (!confirmed || !shown) return;
		const newer = this.#queue.get(id)?.patch ?? {};
		const next = { ...shown };
		if (failed.color !== undefined && newer.color === undefined) next.color = confirmed.color;
		if (failed.note !== undefined && newer.note === undefined) next.note = confirmed.note;
		this.#replace(id, next);
	}

	// The overlapped highlight may come from another tab: fetch the list
	// once and add what is missing, keeping local state (unsaved edits,
	// pending removes) as it is. A failed fetch only means "not available".
	async #overlapResult(bookId: number, seq: number, existingId: number): Promise<AddResult> {
		if (this.get(existingId)) return { ok: false, existingId, available: true };
		let list: Highlight[];
		try {
			list = await this.#api.list(bookId);
		} catch {
			return seq === this.#seq ? { ok: false, existingId, available: false } : { ok: false };
		}
		if (seq !== this.#seq) return { ok: false };
		const known = new Set(this.items.map((h) => h.id));
		const missing = list.filter((h) => !known.has(h.id) && !this.#removing.has(h.id));
		for (const h of missing) this.#server.set(h.id, h);
		if (missing.length > 0) this.items = [...this.items, ...missing].sort(byPlace);
		return { ok: false, existingId, available: this.get(existingId) !== null };
	}

	#entry(id: number): Pending {
		let entry = this.#queue.get(id);
		if (!entry) {
			entry = { patch: {}, waiters: [], remove: null, removeWaiters: [] };
			this.#queue.set(id, entry);
		}
		return entry;
	}

	#real(id: number): number {
		return this.#alias.get(id) ?? id;
	}

	#reset(): void {
		for (const entry of this.#queue.values()) settle(entry, false);
		this.#queue = new Map();
		this.#server = new Map();
		this.#alias = new Map();
		this.#removing = new Set();
		this.#busy = new Set();
	}

	#replace(id: number, next: Highlight): void {
		this.items = this.items.map((h) => (h.id === id ? next : h));
	}

	#mark(id: number, on: boolean): void {
		const next = new Set(this.#busy);
		if (on) next.add(id);
		else next.delete(id);
		this.#busy = next;
	}
}
