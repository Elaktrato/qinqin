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

export function savePrefs(storage: PrefsStorage | null, prefs: ReaderPrefs): void {
	try {
		storage?.setItem(KEY, JSON.stringify(prefs));
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
