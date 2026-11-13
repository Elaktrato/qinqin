// The highlights of the open book, with optimistic updates (the same
// pattern as bookmarkList.svelte.ts). Every change shows at once and is
// rolled back when the server refuses it; results that arrive after the
// reader switched books are dropped (a sequence number per loaded book).
// The API is injected, so this is testable without a server.
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
 * AddResult: the saved highlight, or a refusal. `existingId` names the
 * saved highlight the new span overlaps (the caller opens its editor);
 * any other refusal sets `error`.
 */
export type AddResult = { ok: true; highlight: Highlight } | { ok: false; existingId?: number };

const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

const ANNOUNCE_RUNES = 40;

// Reading order: chapter, paragraph, start (the server's order).
const byPlace = (a: Highlight, b: Highlight) =>
	a.chapter - b.chapter || a.paragraph - b.paragraph || a.start - b.start || a.id - b.id;

export class HighlightList {
	items = $state<Highlight[]>([]);
	bookId = $state<number | null>(null);
	loading = $state(false);
	loadError = $state('');
	/** The last failed change, shown inline. */
	error = $state('');
	/** For a polite live region: what the last change did. */
	announcement = $state('');
	#busy = $state<ReadonlySet<number>>(new Set());

	#api: HighlightApi;
	#seq = 0;
	#nextTemp = -1;

	constructor(api: HighlightApi) {
		this.#api = api;
	}

	/** The list is known: changes are possible. */
	get ready(): boolean {
		return this.bookId !== null && !this.loading && !this.loadError;
	}

	get(id: number): Highlight | null {
		return this.items.find((h) => h.id === id) ?? null;
	}

	/** busy: a change of this highlight is in flight (or it is not saved yet). */
	busy(id: number): boolean {
		return id < 0 || this.#busy.has(id);
	}

	async load(bookId: number): Promise<void> {
		const seq = ++this.#seq;
		this.bookId = bookId;
		this.items = [];
		this.loading = true;
		this.loadError = '';
		this.error = '';
		this.announcement = '';
		this.#busy = new Set();
		try {
			const list = await this.#api.list(bookId);
			if (seq === this.#seq) this.items = [...list].sort(byPlace);
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
		if (known) return known.id > 0 ? { ok: false, existingId: known.id } : { ok: false };
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
		try {
			const saved = await this.#api.add(bookId, body);
			if (seq !== this.#seq) return { ok: false };
			this.items = [...this.items.filter((h) => h.id !== temp.id && h.id !== saved.id), saved].sort(byPlace);
			this.announcement = `Highlight added: ${snippetAt(saved.text, ANNOUNCE_RUNES)}`;
			return { ok: true, highlight: saved };
		} catch (err) {
			if (seq !== this.#seq) return { ok: false };
			this.items = this.items.filter((h) => h.id !== temp.id);
			if (err instanceof HighlightOverlapError) return { ok: false, existingId: err.existingId };
			this.error = apiErrorMessage(err, 'highlight');
			return { ok: false };
		}
	}

	/** update changes colour and/or note; true when the highlight now has them. */
	async update(id: number, patch: HighlightPatch): Promise<boolean> {
		const bookId = this.bookId;
		const current = this.get(id);
		if (bookId === null || !current || this.busy(id)) return false;
		const changes: HighlightPatch = {};
		if (patch.color !== undefined && patch.color !== current.color) changes.color = patch.color;
		if (patch.note !== undefined && patch.note !== current.note) changes.note = patch.note;
		if (changes.color === undefined && changes.note === undefined) return true;
		const seq = this.#seq;
		this.#replace(id, { ...current, ...changes });
		this.#mark(id, true);
		this.error = '';
		try {
			const saved = await this.#api.update(bookId, id, changes);
			if (seq !== this.#seq) return false;
			this.#replace(id, saved);
			this.announcement = 'Highlight updated';
			return true;
		} catch (err) {
			if (seq !== this.#seq) return false;
			if (isGone(err)) this.items = this.items.filter((h) => h.id !== id);
			else this.#replace(id, current);
			this.error = apiErrorMessage(err, 'highlight');
			return false;
		} finally {
			if (seq === this.#seq) this.#mark(id, false);
		}
	}

	async remove(id: number): Promise<void> {
		const bookId = this.bookId;
		const current = this.get(id);
		if (bookId === null || !current || this.busy(id)) return;
		const seq = this.#seq;
		this.items = this.items.filter((h) => h.id !== id);
		this.#mark(id, true);
		this.error = '';
		try {
			await this.#api.remove(bookId, id);
		} catch (err) {
			if (seq !== this.#seq) return;
			// Already gone on the server: that is what was wanted.
			if (!isGone(err)) {
				if (!this.items.some((h) => h.id === id)) this.items = [...this.items, current].sort(byPlace);
				this.error = apiErrorMessage(err, 'highlight');
				return;
			}
		} finally {
			if (seq === this.#seq) this.#mark(id, false);
		}
		if (seq === this.#seq) this.announcement = `Highlight removed: ${snippetAt(current.text, ANNOUNCE_RUNES)}`;
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
