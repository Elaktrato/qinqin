// The reader's side rail (contents, bookmarks, highlights, words, display):
// which tab is shown and whether the wide-screen panel is expanded, remembered per browser in
// localStorage when it is available. Every access is guarded, as in
// prefs.ts: the reader must work without storage.
import type { PrefsStorage } from './prefs';

export type RailTab = 'contents' | 'bookmarks' | 'highlights' | 'words' | 'display';
export const RAIL_TABS: readonly RailTab[] = ['contents', 'bookmarks', 'highlights', 'words', 'display'];

export interface RailState {
	/** The panel beside the icon column is expanded (wide screens). The phone sheet always starts closed. */
	open: boolean;
	tab: RailTab;
}

/** column: icons at the right edge with a panel beside the text; sheet: one top-bar button opening a bottom sheet. */
export type RailMode = 'column' | 'sheet';

/** From this viewport width the rail is a column beside the text. */
export const RAIL_COLUMN_MIN_WIDTH = 1000;

const KEY = 'qinqin.reader.rail';

export const DEFAULT_RAIL_STATE: Readonly<RailState> = Object.freeze({ open: true, tab: 'bookmarks' });

export function loadRailState(storage: PrefsStorage | null): RailState {
	try {
		const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_RAIL_STATE };
		const { open, tab } = raw as Record<string, unknown>;
		return {
			open: typeof open === 'boolean' ? open : DEFAULT_RAIL_STATE.open,
			tab: RAIL_TABS.includes(tab as RailTab) ? (tab as RailTab) : DEFAULT_RAIL_STATE.tab
		};
	} catch {
		return { ...DEFAULT_RAIL_STATE };
	}
}

export function saveRailState(storage: PrefsStorage | null, state: RailState): void {
	try {
		storage?.setItem(KEY, JSON.stringify({ open: state.open, tab: state.tab }));
	} catch {
		// Storage is a convenience; the rail still works for this visit.
	}
}

/** railMode: a column beside the text on wide screens, else a bottom sheet. */
export function railMode(width: number): RailMode {
	return width >= RAIL_COLUMN_MIN_WIDTH ? 'column' : 'sheet';
}

/**
 * tabKeyTarget: the index a key moves the focus to in a vertical tab
 * list (roving tabindex), or null when the key is not a tab-list key.
 * Arrows wrap around; left/right work too, as many users expect them.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowDown':
		case 'ArrowRight':
			return (index + 1) % count;
		case 'ArrowUp':
		case 'ArrowLeft':
			return (index - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}

/**
 * nextFocusIndex: where Tab (or Shift+Tab with `shift`) moves the focus
 * among the `count` focusable elements of an open drawer, wrapping at
 * both ends so focus never leaves it for the page hidden underneath.
 * `current` outside 0..count-1 (focus on none of them) starts at an end.
 * Null when the drawer has nothing focusable.
 *
 * Kept (with its tests) as the drawer's Tab contract: the #102 rail is a
 * modal Sheet whose trap is lib/ui/modal.ts's, so nothing calls this from
 * production any more.
 */
export function nextFocusIndex(count: number, current: number, shift: boolean): number | null {
	if (count <= 0) return null;
	if (current < 0 || current >= count) return shift ? count - 1 : 0;
	return shift ? (current - 1 + count) % count : (current + 1) % count;
}
