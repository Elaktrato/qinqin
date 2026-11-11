// The web plugin registry: a compile-time list of the feature plugins
// this build can render. The server registry stays the source of truth
// for what is installed and enabled; this list says what the SPA has a
// component for, and home intersects the two.

import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import Heatmap from './heatmap/Heatmap.svelte';
import { heatmapManifest } from './heatmap/manifest';

export interface PluginManifest {
	id: string;
	name: string;
	/** Where the plugin may render; home widgets today. */
	surfaces: string[];
}

export interface WebPlugin {
	manifest: PluginManifest;
	component: Component;
}

export const webPlugins: WebPlugin[] = [{ manifest: heatmapManifest, component: Heatmap }];

/**
 * pluginState returns the caller's server state for a web manifest id.
 * Feature plugins are registered server-side under the `qinqin-` pack
 * id (`qinqin-heatmap`) while the web manifest keeps the short client
 * id, so either form resolves to the same state.
 */
export function pluginState(id: string, states: PluginInfo[]): PluginInfo | undefined {
	return states.find((plugin) => plugin.id === id || plugin.id === `qinqin-${id}`);
}

/**
 * pluginEnabled reports whether the caller's server-side state lets a
 * plugin render. A plugin with no state row is enabled — the same
 * default the server applies — so a registry-only plugin still shows.
 */
export function pluginEnabled(id: string, states: PluginInfo[]): boolean {
	const state = pluginState(id, states);
	return state ? state.enabled : true;
}

/**
 * orderPlugins sorts plugins by the server state's order (ascending;
 * absent state counts as order 0) and keeps the registry order for
 * ties, so the home slot matches the Settings order.
 */
export function orderPlugins(plugins: WebPlugin[], states: PluginInfo[]): WebPlugin[] {
	return plugins
		.map((plugin, index) => ({ plugin, index }))
		.sort((a, b) => {
			const orderA = pluginState(a.plugin.manifest.id, states)?.order ?? 0;
			const orderB = pluginState(b.plugin.manifest.id, states)?.order ?? 0;
			return orderA - orderB || a.index - b.index;
		})
		.map(({ plugin }) => plugin);
}
