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
 * pluginEnabled reports whether the caller's server-side state lets a
 * plugin render. A plugin with no state row is enabled — the same
 * default the server applies — so a registry-only plugin still shows.
 * Feature plugins are registered server-side under the `qinqin-` pack
 * id (`qinqin-heatmap`) while the web manifest keeps the short client
 * id, so either form resolves to the same state.
 */
export function pluginEnabled(id: string, states: PluginInfo[]): boolean {
	const state = states.find((plugin) => plugin.id === id || plugin.id === `qinqin-${id}`);
	return state ? state.enabled : true;
}
