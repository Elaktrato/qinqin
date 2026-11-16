// Pure reading-time accounting. Time accrues between consecutive
// activity pings while the page is visible; a gap longer than the idle
// cut-off only counts up to the cut-off, so walking away from an open
// book does not inflate the total. Clocks are passed in, never read.

export const IDLE_CUTOFF_MS = 120_000;
export const MIN_BURST_SECONDS = 30;

export interface ReadingTimer {
	activity(now: number): void;
	hidden(now: number): void;
	visible(now: number): void;
	/** Whole seconds accumulated since the last flush; 0 (and kept) below MIN_BURST_SECONDS. */
	flush(now: number): number;
	/** Milliseconds accumulated and not yet flushed. */
	accrued(): number;
}

export function createReadingTimer(): ReadingTimer {
	let accruedMs = 0;
	let last: number | null = null;
	let isVisible = true;

	// Credit the gap since the previous ping; a backwards clock adds 0.
	function credit(now: number): void {
		if (last !== null && now > last) accruedMs += Math.min(now - last, IDLE_CUTOFF_MS);
	}

	return {
		activity(now) {
			if (!isVisible) return;
			credit(now);
			last = now;
		},
		hidden(now) {
			if (!isVisible) return;
			credit(now);
			isVisible = false;
			last = null;
		},
		visible(now) {
			isVisible = true;
			last = now;
		},
		flush() {
			const seconds = Math.floor(accruedMs / 1000);
			if (seconds < MIN_BURST_SECONDS) return 0;
			accruedMs -= seconds * 1000;
			return seconds;
		},
		accrued() {
			return accruedMs;
		}
	};
}
