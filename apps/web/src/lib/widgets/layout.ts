// The user's home layout: an ordered list of widget ids, stored once per
// user (not per workspace) as the user-global plugin data row
// `qinqin-core` / `home-layout`, so every device shares it and sync
// carries it. A missing row means the default layout; last write wins.

import { getUserPluginData, putUserPluginData } from '$lib/api/pluginData';
import type { WidgetDef, WidgetSurface } from './types';

export const LAYOUT_PLUGIN_ID = 'qinqin-core';
export const LAYOUT_KEY = 'home-layout';
const LAYOUT_VERSION = 1;

/** Today's home: the activity heatmap, then the flashcards summary. */
export const DEFAULT_LAYOUT: readonly string[] = ['activity-heatmap', 'flashcards-summary'];

export interface StoredLayout {
	version: typeof LAYOUT_VERSION;
	widgets: string[];
}

/**
 * parseLayout reads a stored value. Anything but an object with an
 * integer `version` of 1 or more and a `widgets` array is no layout
 * (null, so the default applies); array entries that are not non-empty
 * strings are dropped. A newer version (a newer client) is read
 * leniently: its string ids count, everything else is ignored.
 */
export function parseLayout(value: unknown): string[] | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { version, widgets } = value as Record<string, unknown>;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < LAYOUT_VERSION) {
		return null;
	}
	if (!Array.isArray(widgets)) return null;
	return widgets.filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * serializeLayout writes a version 1 value. Saving over a row of a newer
 * version therefore replaces it with version 1 (only the ids this client
 * understands survive); a newer client must accept version 1 rows.
 */
export function serializeLayout(ids: readonly string[]): StoredLayout {
	return { version: LAYOUT_VERSION, widgets: [...ids] };
}

/**
 * resolveLayout turns stored ids into the widgets to render on a
 * surface: unknown and unavailable ids (a disabled plugin, another
 * language) are dropped but stay stored, duplicates keep their first
 * position, the order is kept. No stored layout means DEFAULT_LAYOUT; an
 * empty stored layout stays empty.
 */
export function resolveLayout(
	stored: readonly string[] | null,
	available: readonly WidgetDef[],
	surface: WidgetSurface
): WidgetDef[] {
	const byId = new Map(available.map((widget) => [widget.id, widget]));
	const seen = new Set<string>();
	const resolved: WidgetDef[] = [];
	for (const id of stored ?? DEFAULT_LAYOUT) {
		const widget = byId.get(id);
		if (!widget || seen.has(id) || !widget.surfaces.includes(surface)) continue;
		seen.add(id);
		resolved.push(widget);
	}
	return resolved;
}

/**
 * homeEmptyReason says why the home page shows no widget: the stored
 * layout chose none ('none-chosen'), or it chose some that cannot be
 * shown in this workspace (another language, a disabled plugin:
 * 'none-available'). Null while at least one widget is shown.
 */
export function homeEmptyReason(
	stored: readonly string[] | null,
	shownCount: number
): 'none-chosen' | 'none-available' | null {
	if (shownCount > 0) return null;
	return (stored ?? DEFAULT_LAYOUT).length === 0 ? 'none-chosen' : 'none-available';
}

export interface PlacedWidget {
	widget: WidgetDef;
	/** Spans both columns of the two-column grid. */
	span: boolean;
}

/**
 * placeWidgets decides which widgets span the whole row of the
 * two-column grid: every wide widget, and a normal widget that has no
 * normal neighbour to share its row with (so no half-empty rows).
 */
export function placeWidgets(widgets: readonly WidgetDef[]): PlacedWidget[] {
	const placed: PlacedWidget[] = [];
	let column = 0;
	widgets.forEach((widget, index) => {
		if (widget.size === 'wide') {
			placed.push({ widget, span: true });
			column = 0;
		} else if (column === 1) {
			placed.push({ widget, span: false });
			column = 0;
		} else {
			const partner = widgets[index + 1]?.size === 'normal';
			placed.push({ widget, span: !partner });
			column = partner ? 1 : 0;
		}
	});
	return placed;
}

/**
 * loadLayout reads the user's stored layout: null when there is none or
 * it is corrupt (use the default). Network and server errors reject.
 */
export async function loadLayout(): Promise<string[] | null> {
	return parseLayout(await getUserPluginData(LAYOUT_PLUGIN_ID, LAYOUT_KEY));
}

/** saveLayout stores the user's layout for every device. */
export async function saveLayout(ids: readonly string[]): Promise<void> {
	await putUserPluginData(LAYOUT_PLUGIN_ID, LAYOUT_KEY, serializeLayout(ids));
}
