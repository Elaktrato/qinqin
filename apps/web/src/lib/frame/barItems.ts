// The phone bottom bar's items (#188): from the visible sections (Home
// first, then the frame order of lib/frame/sections.ts) and the stored pins
// (lib/frame/navLayout.ts) to what the bar shows. Pure, so the five-item
// rule is tested without rendering (contract: docs/contracts/settings/
// nav-layout.json, `items`).
//
// - Pins count when visible, each once (the first wins); hidden and unknown
//   ids are skipped (and stay stored).
// - Everything fits (five or fewer visible sections): all are shown, the
//   pins first in their order, then the others in frame order. No More.
// - Otherwise: the first four pins, then More. More lists the remaining
//   pins in their order, then the unpinned sections in frame order.
// - Current: the current section's item, or More when the section is one of
//   its rows, or nothing (a page of no section: Settings, Sources).

import { BAR_MAX_ITEMS } from './navLayout';
import type { FrameSection } from './sections';

/** The More item (a marker, not a section). */
export const MORE = Symbol('more');
export type BarItem = FrameSection | typeof MORE;

export interface BarLayout {
	items: BarItem[];
	/** The rows of the More sheet (empty when there is no More). */
	more: FrameSection[];
	/** The id of the current item, `more`, or null. */
	current: string | null;
}

export function barItems(
	visible: readonly FrameSection[],
	bar: readonly string[],
	current: string | null
): BarLayout {
	const byId = new Map(visible.map((section) => [section.id, section]));
	const pinned: FrameSection[] = [];
	for (const id of bar) {
		const section = byId.get(id);
		if (section && !pinned.includes(section)) pinned.push(section);
	}
	const rest = visible.filter((section) => !pinned.includes(section));

	if (visible.length <= BAR_MAX_ITEMS) {
		const items = [...pinned, ...rest];
		return { items, more: [], current: items.some((s) => s.id === current) ? current : null };
	}

	const shown = pinned.slice(0, BAR_MAX_ITEMS - 1);
	const more = [...pinned.slice(BAR_MAX_ITEMS - 1), ...rest];
	const mark = shown.some((s) => s.id === current) ? current : more.some((s) => s.id === current) ? 'more' : null;
	return { items: [...shown, MORE], more, current: mark };
}
