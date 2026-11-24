// Stats → Overview's default arrangement: the design's order first, then
// every other available widget in registry order. The widget surface
// contract is untouched; a feature widget is never dropped.

import type { WidgetDef } from '$lib/widgets/types';

/** The design's default order (`docs/contracts/stats/`). */
export const STATS_ORDER: readonly string[] = [
	'summary-numbers',
	'word-states',
	'flashcards-summary',
	'reviews-per-day',
	'activity-heatmap',
	'character-map-summary',
	'reading-time'
];

/**
 * statsOrder places the default ids in their design order, then every
 * other widget in the order it came in (the registry's: core, features,
 * features). A default id that is unavailable is simply absent.
 */
export function statsOrder(widgets: readonly WidgetDef[]): WidgetDef[] {
	const byId = new Map<string, WidgetDef>();
	const unique: WidgetDef[] = [];
	for (const widget of widgets) {
		if (byId.has(widget.id)) continue;
		byId.set(widget.id, widget);
		unique.push(widget);
	}
	const placed: WidgetDef[] = [];
	const seen = new Set<string>();
	for (const id of STATS_ORDER) {
		const widget = byId.get(id);
		if (widget === undefined || seen.has(id)) continue;
		seen.add(id);
		placed.push(widget);
	}
	for (const widget of unique) {
		if (seen.has(widget.id)) continue;
		seen.add(widget.id);
		placed.push(widget);
	}
	return placed;
}
