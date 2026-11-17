// Debounced saving of the reading position: scrolling produces a stream of
// "first paragraph in view" values and only the last one, after a pause,
// goes to the server. Failures are ignored: losing one update is harmless
// and the reader is never bothered with it.

export type SavePosition = (bookId: number, position: string) => Promise<void>;

export class PositionSaver {
	#save: SavePosition;
	#delay: number;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: { bookId: number; position: string } | null = null;
	#last = '';

	constructor(save: SavePosition, delay: number) {
		this.#save = save;
		this.#delay = delay;
	}

	/** reset drops anything pending and records the position the server already has. */
	reset(stored: string): void {
		clearTimeout(this.#timer);
		this.#pending = null;
		this.#last = stored;
	}

	schedule(bookId: number, position: string): void {
		clearTimeout(this.#timer);
		this.#pending = position === this.#last ? null : { bookId, position };
		if (this.#pending) this.#timer = setTimeout(() => this.flush(), this.#delay);
	}

	/** flush saves a pending position now (e.g. when leaving the book). */
	flush(): void {
		clearTimeout(this.#timer);
		const pending = this.#pending;
		this.#pending = null;
		if (!pending) return;
		this.#last = pending.position;
		this.#save(pending.bookId, pending.position).catch(() => {});
	}
}
