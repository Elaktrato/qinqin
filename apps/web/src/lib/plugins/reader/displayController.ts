// Holds the reader's display settings for one workspace: changes show at
// once, are collected and saved as one workspace-settings patch after a
// short pause. A failed save keeps what the reader sees.
import { displayPatch, parseDisplay, type ReaderDisplay } from './displaySettings';

export const SAVE_DELAY_MS = 400;

export interface DisplayController {
	readonly display: ReaderDisplay;
	change(change: Partial<ReaderDisplay>): void;
	/** Saves a pending change now. */
	flush(): Promise<void>;
	/** Re-reads the workspace settings unless a change is waiting to be saved. */
	adopt(): void;
	destroy(): void;
}

export function createDisplayController(opts: {
	settings: () => Record<string, unknown> | null;
	localFurigana: () => boolean | null;
	save: (patch: Record<string, unknown>) => Promise<unknown>;
	onError: (err: unknown) => void;
	onChange?: (display: ReaderDisplay) => void;
}): DisplayController {
	let display = parseDisplay(opts.settings(), opts.localFurigana());
	let pending: Partial<ReaderDisplay> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const set = (next: ReaderDisplay): void => {
		display = next;
		opts.onChange?.(next);
	};

	async function flush(): Promise<void> {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		const change = pending;
		pending = null;
		if (change === null) return;
		try {
			await opts.save(displayPatch(change, opts.settings()));
		} catch (err) {
			opts.onError(err);
		}
	}

	return {
		get display() {
			return display;
		},
		change(change) {
			set({ ...display, ...change });
			pending = { ...pending, ...change };
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
		},
		flush,
		adopt() {
			if (pending !== null) return;
			set(parseDisplay(opts.settings(), opts.localFurigana()));
		},
		destroy() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
		}
	};
}
