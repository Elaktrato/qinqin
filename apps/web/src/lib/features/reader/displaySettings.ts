// The reader's per-workspace display settings: the `reader` object of the
// workspace settings (docs/contracts/reader/). Parsing is per field and
// forgiving; unknown keys are kept on write so a newer client's fields
// survive an older one saving.
import { READER_FONTS, type ReaderFont } from './fonts';

export type ReadingsMode = 'never' | 'always' | 'smart';
export const READINGS_MODES: readonly ReadingsMode[] = ['never', 'always', 'smart'];
export const RUBY_SCALES = [0.45, 0.55, 0.65, 0.75] as const;
export const THRESHOLD_MIN = 10;
export const THRESHOLD_MAX = 100;

export interface ReaderDisplay {
	/** The book's own ruby (EPUB ruby, Aozora). */
	bookRuby: boolean;
	/** Dictionary readings over words. */
	readings: ReadingsMode;
	/** A word with a memory score at or above this counts as known (smart). */
	smartThreshold: number;
	rubyScale: number;
	font: ReaderFont;
	/** Mark new and learning words in the text (#68). */
	highlightWords: boolean;
}

export const DEFAULT_DISPLAY: ReaderDisplay = {
	bookRuby: true,
	readings: 'never',
	smartThreshold: 80,
	rubyScale: 0.55,
	font: 'default',
	highlightWords: false
};

function threshold(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(value)));
}

function scale(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	let best: number = RUBY_SCALES[0];
	for (const s of RUBY_SCALES) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
	return best;
}

function readerObject(settings: Record<string, unknown> | null): Record<string, unknown> {
	const raw = settings?.reader;
	return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * parseDisplay reads the workspace settings. `localFurigana` is the legacy
 * per-browser Furigana toggle: it is the default of `bookRuby` until the
 * workspace has its own value.
 */
export function parseDisplay(
	settings: Record<string, unknown> | null,
	localFurigana: boolean | null
): ReaderDisplay {
	const r = readerObject(settings);
	return {
		bookRuby: typeof r.bookRuby === 'boolean' ? r.bookRuby : (localFurigana ?? DEFAULT_DISPLAY.bookRuby),
		readings: READINGS_MODES.includes(r.readings as ReadingsMode)
			? (r.readings as ReadingsMode)
			: DEFAULT_DISPLAY.readings,
		smartThreshold: threshold(r.smartThreshold) ?? DEFAULT_DISPLAY.smartThreshold,
		rubyScale: scale(r.rubyScale) ?? DEFAULT_DISPLAY.rubyScale,
		font: READER_FONTS.includes(r.font as ReaderFont) ? (r.font as ReaderFont) : DEFAULT_DISPLAY.font,
		highlightWords: typeof r.highlightWords === 'boolean' ? r.highlightWords : DEFAULT_DISPLAY.highlightWords
	};
}

/**
 * displayPatch is the `settings` patch that stores `change`: the stored
 * reader object (unknown keys included) with the sanitized change on top.
 * The server merges objects (RFC 7396), so this never drops another key.
 */
export function displayPatch(
	change: Partial<ReaderDisplay>,
	settings: Record<string, unknown> | null
): { reader: Record<string, unknown> } {
	const clean: Record<string, unknown> = {};
	if (change.bookRuby !== undefined) clean.bookRuby = change.bookRuby;
	if (change.readings !== undefined) clean.readings = change.readings;
	if (change.smartThreshold !== undefined) clean.smartThreshold = threshold(change.smartThreshold) ?? DEFAULT_DISPLAY.smartThreshold;
	if (change.rubyScale !== undefined) clean.rubyScale = scale(change.rubyScale) ?? DEFAULT_DISPLAY.rubyScale;
	if (change.font !== undefined) clean.font = change.font;
	if (change.highlightWords !== undefined) clean.highlightWords = change.highlightWords === true;
	return { reader: { ...readerObject(settings), version: 1, ...clean } };
}
