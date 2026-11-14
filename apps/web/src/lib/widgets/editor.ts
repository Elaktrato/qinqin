// Pure helpers for the Settings → Home layout editor. They edit the
// stored layout, not only what is listed: ids of widgets that are
// unavailable right now (a disabled plugin, a widget this build no
// longer has) keep their place, so re-enabling the plugin restores them.

import { DEFAULT_LAYOUT } from './layout';
import type { WidgetDef } from './types';

/** editableLayout is a fresh, de-duplicated copy of the stored layout (null = default). */
export function editableLayout(stored: readonly string[] | null): string[] {
	return [...new Set(stored ?? DEFAULT_LAYOUT)];
}

/** toggleWidget puts a widget on the home page (at the end) or takes it off. */
export function toggleWidget(stored: readonly string[] | null, id: string, on: boolean): string[] {
	const layout = editableLayout(stored);
	if (on) return layout.includes(id) ? layout : [...layout, id];
	return layout.filter((other) => other !== id);
}

/**
 * moveWidgetTo moves a widget to `target` (0-based, clamped) among the
 * stored ids that are `listed`; the other stored ids keep their slots.
 * An id that is not on the home page changes nothing.
 */
export function moveWidgetTo(
	stored: readonly string[] | null,
	id: string,
	target: number,
	listed: Iterable<string>
): string[] {
	const layout = editableLayout(stored);
	const isListed = new Set(listed);
	const slots: number[] = [];
	layout.forEach((other, index) => {
		if (isListed.has(other)) slots.push(index);
	});
	const order = slots.map((slot) => layout[slot]);
	const from = order.indexOf(id);
	if (from < 0) return layout;
	const to = Math.max(0, Math.min(order.length - 1, target));
	order.splice(from, 1);
	order.splice(to, 0, id);
	slots.forEach((slot, index) => (layout[slot] = order[index]));
	return layout;
}

/** moveWidget moves a widget one place up (-1) or down (1); a no-op at the ends. */
export function moveWidget(
	stored: readonly string[] | null,
	id: string,
	direction: -1 | 1,
	listed: Iterable<string>
): string[] {
	const isListed = new Set(listed);
	const order = editableLayout(stored).filter((other) => isListed.has(other));
	const from = order.indexOf(id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= order.length) return editableLayout(stored);
	return moveWidgetTo(stored, id, to, isListed);
}

/** resetLayout is the default layout, as a list to store. */
export function resetLayout(): string[] {
	return [...DEFAULT_LAYOUT];
}

export interface EditorItem {
	widget: WidgetDef;
	/** In the stored layout. */
	on: boolean;
	/** 1-based place among the listed widgets that are on; null when off. */
	position: number | null;
	/** How many listed widgets are on. */
	onCount: number;
	/** False when the widget does not apply to the active workspace's language. */
	applies: boolean;
}

/**
 * displayItems lists every home-capable widget of `all` for the editor:
 * the ones on the home page in layout order, then the others in
 * registry order. `language` null (no workspace) marks everything as
 * applying.
 */
export function displayItems(
	stored: readonly string[] | null,
	all: readonly WidgetDef[],
	language: string | null
): EditorItem[] {
	const homeCapable = all.filter((widget) => widget.surfaces.includes('home'));
	const byId = new Map(homeCapable.map((widget) => [widget.id, widget]));
	const onWidgets = editableLayout(stored)
		.map((id) => byId.get(id))
		.filter((widget): widget is WidgetDef => widget !== undefined);
	const onIds = new Set(onWidgets.map((widget) => widget.id));
	const offWidgets = homeCapable.filter((widget) => !onIds.has(widget.id));
	const applies = (widget: WidgetDef) =>
		language === null || !widget.appliesTo || widget.appliesTo(language);
	return [
		...onWidgets.map((widget, index) => ({
			widget,
			on: true,
			position: index + 1,
			onCount: onWidgets.length,
			applies: applies(widget)
		})),
		...offWidgets.map((widget) => ({
			widget,
			on: false,
			position: null,
			onCount: onWidgets.length,
			applies: applies(widget)
		}))
	];
}
