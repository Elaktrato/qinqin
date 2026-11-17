// Per-viewer reading toggles, remembered in localStorage when it is
// available. Every access is guarded: private windows and blocked site
// data make storage throw, and the reader must work without it.
import { VARIANTS, type Variant } from './variants';

export interface ReaderPrefs {
	furigana: boolean;
	variant: Variant;
}

export interface PrefsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const KEY = 'qinqin.reader.prefs';

export const DEFAULT_PREFS: ReaderPrefs = { furigana: true, variant: 'original' };

export function loadPrefs(storage: PrefsStorage | null): ReaderPrefs {
	try {
		const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
		if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS };
		const { furigana, variant } = raw as Record<string, unknown>;
		return {
			furigana: typeof furigana === 'boolean' ? furigana : DEFAULT_PREFS.furigana,
			variant: VARIANTS.includes(variant as Variant) ? (variant as Variant) : DEFAULT_PREFS.variant
		};
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

/**
 * saveVariant stores the script choice. The old per-browser `furigana`
 * flag is not written any more (book ruby is a per-workspace setting now),
 * but a stored value stays: it is the default until the workspace has its own.
 */
export function saveVariant(storage: PrefsStorage | null, variant: Variant): void {
	merge(storage, { variant });
}

/** saveFurigana: the per-browser book ruby flag, used only where no workspace holds the setting. */
export function saveFurigana(storage: PrefsStorage | null, furigana: boolean): void {
	merge(storage, { furigana });
}

function merge(storage: PrefsStorage | null, change: Record<string, unknown>): void {
	try {
		let stored: Record<string, unknown> = {};
		try {
			const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
			if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) stored = raw as Record<string, unknown>;
		} catch {
			// Corrupt data: start over.
		}
		storage?.setItem(KEY, JSON.stringify({ ...stored, ...change }));
	} catch {
		// Storage is a convenience; the toggles still work for this visit.
	}
}

/** browserStorage returns localStorage, or null where touching it throws. */
export function browserStorage(): PrefsStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
