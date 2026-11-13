// The bookmarks of the open book, with optimistic updates. Every change
// shows at once and is rolled back when the server refuses it; results
// that arrive after the reader switched books are dropped (a sequence
// number per loaded book). The API is injected, so this is testable
// without a server.
import { ApiError } from '$lib/api/client';
import { bookmarkAt, bookmarkName, type Bookmark } from './bookmarks';
import { apiErrorMessage } from './errors';

export interface BookmarkApi {
	list(bookId: number): Promise<Bookmark[]>;
	add(bookId: number, position: string, label: string): Promise<Bookmark>;
	rename(bookId: number, id: number, label: string): Promise<Bookmark>;
	remove(bookId: number, id: number): Promise<void>;
}

const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

export class BookmarkList {
	items = $state<Bookmark[]>([]);
	bookId = $state<number | null>(null);
	loading = $state(false);
	loadError = $state('');
	/** The last failed change, shown inline. */
	error = $state('');
	/** For a polite live region: what the last change did. */
	announcement = $state('');
	/** A toolbar add/remove is in flight. */
	saving = $state(false);
	#busy = $state<ReadonlySet<number>>(new Set());

	#api: BookmarkApi;
	#seq = 0;
	#nextTemp = -1;

	constructor(api: BookmarkApi) {
		this.#api = api;
	}

	/** The list is known: changes are possible. */
	get ready(): boolean {
		return this.bookId !== null && !this.loading && !this.loadError;
	}

	at(position: string): Bookmark | null {
		return bookmarkAt(this.items, position);
	}

	/** busy: a rename or delete of this bookmark is in flight (or it is not saved yet). */
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
		this.saving = false;
		this.#busy = new Set();
		try {
			const list = await this.#api.list(bookId);
			if (seq === this.#seq) this.items = list;
		} catch (err) {
			if (seq === this.#seq) this.loadError = apiErrorMessage(err, 'bookmarks');
		} finally {
			if (seq === this.#seq) this.loading = false;
		}
	}

	/**
	 * toggle removes the bookmark at `position`, or adds one there with
	 * `label`. Ignored while a toggle is saving or the list is not loaded.
	 */
	async toggle(position: string, label: string): Promise<void> {
		// After a failed load a press retries it (the reader then sees the
		// state of this spot) rather than doing nothing.
		if (this.loadError && this.bookId !== null && !this.loading) return this.load(this.bookId);
		if (this.saving || !this.ready) return;
		const existing = this.at(position);
		if (existing && this.busy(existing.id)) return;
		this.saving = true;
		const seq = this.#seq;
		try {
			if (existing) await this.remove(existing.id);
			else await this.#add(position, label);
		} finally {
			if (seq === this.#seq) this.saving = false;
		}
	}

	async #add(position: string, label: string): Promise<void> {
		const bookId = this.bookId;
		if (bookId === null) return;
		const seq = this.#seq;
		const temp: Bookmark = {
			id: this.#nextTemp--,
			bookId,
			position,
			label,
			createdAt: new Date().toISOString()
		};
		this.items = [...this.items, temp];
		this.error = '';
		try {
			const saved = await this.#api.add(bookId, position, label);
			if (seq !== this.#seq) return;
			// 200 returns an existing bookmark: never list it twice.
			this.items = [...this.items.filter((b) => b.id !== temp.id && b.id !== saved.id), saved];
			this.announcement = `Bookmark added: ${bookmarkName(saved)}`;
		} catch (err) {
			if (seq !== this.#seq) return;
			this.items = this.items.filter((b) => b.id !== temp.id);
			this.error = apiErrorMessage(err, 'bookmark');
		}
	}

	async rename(id: number, label: string): Promise<void> {
		const bookId = this.bookId;
		const current = this.items.find((b) => b.id === id);
		const wanted = label.trim();
		if (bookId === null || !current || this.busy(id) || wanted === current.label) return;
		const seq = this.#seq;
		const old = current.label;
		this.#setLabel(id, wanted);
		this.#mark(id, true);
		this.error = '';
		try {
			const saved = await this.#api.rename(bookId, id, wanted);
			if (seq !== this.#seq) return;
			this.#setLabel(id, saved.label);
			this.announcement = `Bookmark renamed: ${bookmarkName(saved)}`;
		} catch (err) {
			if (seq !== this.#seq) return;
			if (isGone(err)) this.items = this.items.filter((b) => b.id !== id);
			else this.#setLabel(id, old);
			this.error = apiErrorMessage(err, 'bookmark');
		} finally {
			if (seq === this.#seq) this.#mark(id, false);
		}
	}

	async remove(id: number): Promise<void> {
		const bookId = this.bookId;
		const current = this.items.find((b) => b.id === id);
		if (bookId === null || !current || this.busy(id)) return;
		const seq = this.#seq;
		this.items = this.items.filter((b) => b.id !== id);
		this.#mark(id, true);
		this.error = '';
		try {
			await this.#api.remove(bookId, id);
		} catch (err) {
			if (seq !== this.#seq) return;
			// Already gone on the server: that is what was wanted.
			if (!isGone(err)) {
				if (!this.items.some((b) => b.id === id)) this.items = [...this.items, current];
				this.error = apiErrorMessage(err, 'bookmark');
				return;
			}
		} finally {
			if (seq === this.#seq) this.#mark(id, false);
		}
		if (seq === this.#seq) this.announcement = `Bookmark removed: ${bookmarkName(current)}`;
	}

	#setLabel(id: number, label: string): void {
		this.items = this.items.map((b) => (b.id === id ? { ...b, label } : b));
	}

	#mark(id: number, on: boolean): void {
		const next = new Set(this.#busy);
		if (on) next.add(id);
		else next.delete(id);
		this.#busy = next;
	}
}

// Input types that take no typed text: a `b` there is no character.
const NON_TEXT_INPUTS = new Set([
	'checkbox',
	'radio',
	'button',
	'submit',
	'reset',
	'image',
	'range',
	'color',
	'file',
	'hidden'
]);

/**
 * isTextEntry: the focused element takes typed text (text-like inputs,
 * textarea, contenteditable). Checkboxes, buttons and closed selects do
 * not, so `b` still works after ticking Furigana or picking a chapter.
 */
export function isTextEntry(
	el: { tagName: string; type?: string; isContentEditable?: boolean } | null
): boolean {
	if (!el) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName.toUpperCase();
	if (tag === 'TEXTAREA') return true;
	if (tag !== 'INPUT') return false;
	return !NON_TEXT_INPUTS.has((el.type ?? '').toLowerCase());
}

/** Focus inside these (or on the trigger of an open one) means a widget owns the keys. */
export const WIDGET_SELECTOR =
	'[role="listbox"], [role="menu"], [role="dialog"], [aria-haspopup][aria-expanded="true"]';
/** These are rendered only while open (workspace picker, deck menu). */
export const OPEN_WIDGET_SELECTOR = '[role="listbox"], [role="menu"]';

/**
 * inWidget: a listbox, menu or dialog has focus (the key event's target is
 * inside one, or is the trigger of an open one), or a listbox or menu is
 * open anywhere on the page. A plain disclosure (aria-expanded without
 * aria-haspopup, like the bookmarks panel toggle) does not count.
 */
export function inWidget(
	target: { closest(selector: string): unknown } | null,
	doc: { querySelector(selector: string): unknown } | null
): boolean {
	if (target && target.closest(WIDGET_SELECTOR)) return true;
	return !!doc && !!doc.querySelector(OPEN_WIDGET_SELECTOR);
}

export interface KeyLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat: boolean;
	isComposing: boolean;
	defaultPrevented: boolean;
}

/**
 * bookmarkKey says whether a keydown is the bookmark shortcut: a plain
 * `b` (Caps Lock allowed, no modifiers, not held, not part of an IME
 * composition), not while typing into a field and not with a lookup popup
 * open.
 */
export function bookmarkKey(e: KeyLike, ctx: { typing: boolean; popupOpen: boolean }): boolean {
	if (e.key !== 'b' && e.key !== 'B') return false;
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
	if (e.repeat || e.isComposing || e.defaultPrevented) return false;
	return !ctx.typing && !ctx.popupOpen;
}
