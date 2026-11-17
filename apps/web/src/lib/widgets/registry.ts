// The widget registry: the widgets the current user can see right now,
// from the core app and from the web plugins the server lists as
// installed and enabled for them.

import type { PluginInfo } from '$lib/api/types';
import { featureWidgets } from '$lib/features';
import { pluginState, type WebPlugin } from '$lib/plugins';
import { coreWidgets } from './core';
import type { WidgetDef } from './types';

/**
 * allWidgets lists the available widgets: core widgets first, then those
 * of the core features that are on (lib/features), then the widgets of
 * each web plugin in registry order. A plugin's widgets
 * exist only while the server lists the plugin (installed) and it is
 * enabled, so with no states loaded only core widgets remain. With a
 * language set, a widget's `appliesTo` must accept it; a null language
 * (no workspace) applies no filter. A duplicated id keeps its first
 * widget.
 */
export function allWidgets(
	plugins: WebPlugin[],
	states: PluginInfo[],
	language: string | null,
	core: WidgetDef[] = coreWidgets
): WidgetDef[] {
	const fromPlugins = plugins.flatMap((plugin) => {
		const state = pluginState(plugin.manifest.id, states);
		return state?.enabled ? (plugin.manifest.widgets ?? []) : [];
	});
	const seen = new Set<string>();
	return [...core, ...featureWidgets(states), ...fromPlugins].filter((widget) => {
		if (seen.has(widget.id)) return false;
		seen.add(widget.id);
		return language === null || !widget.appliesTo || widget.appliesTo(language);
	});
}
