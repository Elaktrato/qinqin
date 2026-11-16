// The hover dwell rule of the lookup history (#72): a root hover popup with a
// result counts after it stayed open HOVER_DWELL_MS, or at once when the
// pointer enters it; once per shown popup. Passing the mouse over a line
// (a popup every 80 ms) records nothing.

export const HOVER_DWELL_MS = 1000;

export class DwellCounter {
	#onCount: (entryId: number) => void;
	#current: number | null = null;
	#counted = false;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(onCount: (entryId: number) => void) {
		this.#onCount = onCount;
	}

	/** A root popup now shows `entryId` as its first result (null: no result). */
	shown(entryId: number | null): void {
		this.#stop();
		this.#current = entryId;
		this.#counted = false;
		if (entryId !== null) this.#timer = setTimeout(() => this.#count(), HOVER_DWELL_MS);
	}

	/** The pointer entered the popup. */
	entered(): void {
		this.#count();
	}

	closed(): void {
		this.#stop();
		this.#current = null;
	}

	#count(): void {
		if (this.#current === null || this.#counted) return;
		this.#counted = true;
		this.#stop();
		this.#onCount(this.#current);
	}

	#stop(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
	}
}
