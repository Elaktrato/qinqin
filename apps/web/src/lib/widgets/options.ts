// Options of individual home widgets: the user-global plugin data row
// `qinqin-core` / `widget-options`, one member per widget id. Today only the
// activity heatmap has one: its home layout. Unknown keys (top-level and
// inside a widget's member) are never dropped; a write re-reads the row
// first so keys another device wrote meanwhile survive.
// Contract: docs/contracts/settings/README.md, widget-options.json.

import { keyedData } from '$lib/sync/keyed';

export const WIDGET_OPTIONS_KEY = 'widget-options';
export const HEATMAP_LAYOUTS = ['garden', 'month', 'week'] as const;
export type HeatmapLayout = (typeof HEATMAP_LAYOUTS)[number];
export const DEFAULT_HEATMAP_LAYOUT: HeatmapLayout = 'garden';

const HEATMAP_ID = 'activity-heatmap';

export interface WidgetOptions {
	/** The stored object (null for none or a malformed row), kept for writing. */
	row: Record<string, unknown> | null;
	heatmapLayout: HeatmapLayout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function isHeatmapLayout(value: unknown): value is HeatmapLayout {
	return typeof value === 'string' && (HEATMAP_LAYOUTS as readonly string[]).includes(value);
}

/**
 * parseWidgetOptions reads a stored value. A newer version is read
 * leniently; anything not understood reads as the garden default.
 */
export function parseWidgetOptions(value: unknown): WidgetOptions {
	if (!isRecord(value)) return { row: null, heatmapLayout: DEFAULT_HEATMAP_LAYOUT };
	if (!validVersion(value.version)) return { row: value, heatmapLayout: DEFAULT_HEATMAP_LAYOUT };
	const heatmap = value[HEATMAP_ID];
	const layout = isRecord(heatmap) && isHeatmapLayout(heatmap.layout) ? heatmap.layout : DEFAULT_HEATMAP_LAYOUT;
	return { row: value, heatmapLayout: layout };
}

/**
 * withHeatmapLayout is the row to write: the stored object with only
 * `activity-heatmap.layout` replaced; every other key kept, `version` kept
 * when it is an integer ≥ 1 (else 1). A non-object row starts fresh.
 */
export function withHeatmapLayout(stored: unknown, layout: HeatmapLayout): Record<string, unknown> {
	const base = isRecord(stored) ? stored : {};
	const heatmap = isRecord(base[HEATMAP_ID]) ? (base[HEATMAP_ID] as Record<string, unknown>) : {};
	return {
		...base,
		version: validVersion(base.version) ? base.version : 1,
		[HEATMAP_ID]: { ...heatmap, layout }
	};
}

function store() {
	return keyedData(null);
}

/** loadWidgetOptions reads the row (find: no 404 for a never-saved row). Errors reject. */
export async function loadWidgetOptions(): Promise<WidgetOptions> {
	return parseWidgetOptions(await store().find(WIDGET_OPTIONS_KEY));
}

/** saveHeatmapLayout re-reads the row, changes only the layout and writes it. */
export async function saveHeatmapLayout(layout: HeatmapLayout): Promise<void> {
	const data = store();
	const fresh = await data.find(WIDGET_OPTIONS_KEY);
	await data.put(WIDGET_OPTIONS_KEY, withHeatmapLayout(fresh, layout));
}
