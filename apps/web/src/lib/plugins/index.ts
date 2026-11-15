// The web plugin registry: a compile-time list of the feature plugins
// this build can render. The server registry stays the source of truth
// for what is installed and enabled; this list says what the SPA has a
// component for (pages, widgets), and the shell intersects the two.

import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import type { SourceCredit } from '$lib/sources/credits';
import type { WidgetDef } from '$lib/widgets/types';
import type { ContractManifest } from './contract';
import { CORE_PLUGIN_ID } from './core/manifest';
import type { PluginStatesValue } from './states';
import { flashcardsManifest } from './flashcards/manifest';
import GrammarPage from './grammar/GrammarPage.svelte';
import { grammarManifest } from './grammar/manifest';
import JournalPage from './journal/JournalPage.svelte';
import { journalManifest } from './journal/manifest';
import ReaderPage from './reader/ReaderPage.svelte';
import { readerManifest } from './reader/manifest';

/**
 * PluginManifest is the checked contract (ContractManifest, the server's
 * JSON) plus what only the web build knows: credits and widgets.
 */
export type PluginManifest = ContractManifest & {
	/**
	 * Third-party material the plugin ships or fetches, credited on the
	 * Sources page under "Plugins". Material shared with the rest of the
	 * app is credited once, in lib/sources/coreCredits.ts, instead.
	 */
	sources?: SourceCredit[];
	/**
	 * Stats and home widgets the plugin supplies. They exist only while
	 * the plugin is installed and enabled (lib/widgets/registry.ts).
	 */
	widgets?: WidgetDef[];
};

export interface PluginPage {
	title: string;
	/** Show a link in the shell nav. */
	nav?: boolean;
	/** Rendered at /p/<slug>/<rest>; routes `rest` internally. */
	component: Component<{ rest: string }>;
}

export interface WebPlugin {
	manifest: PluginManifest;
	pages?: PluginPage[];
}

export const webPlugins: WebPlugin[] = [
	{ manifest: flashcardsManifest },
	{
		manifest: readerManifest,
		pages: [{ title: 'Reader', nav: true, component: ReaderPage }]
	},
	{
		manifest: journalManifest,
		pages: [{ title: 'Journal', nav: true, component: JournalPage }]
	},
	{
		manifest: grammarManifest,
		pages: [{ title: 'Grammar', nav: true, component: GrammarPage }]
	}
];

export { CORE_PLUGIN_ID };

/** isCorePlugin is true for the core app's own registry row. */
export function isCorePlugin(id: string): boolean {
	return id === CORE_PLUGIN_ID;
}

/**
 * pluginState returns the caller's server state for a web manifest id.
 * Feature plugins are registered server-side under the `qinqin-` pack
 * id (`qinqin-flashcards`) while callers may hold the short client id,
 * so either form resolves to the same state.
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
 * ties, so the nav matches the Settings order.
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

/** pluginSlug is the URL segment for a plugin id: `qinqin-reader` -> `reader`. */
export function pluginSlug(id: string): string {
	return id.startsWith('qinqin-') ? id.slice('qinqin-'.length) : id;
}

/**
 * navPages lists the shell nav links of enabled plugins that declare a
 * nav page, in the user's plugin order.
 */
export function navPages(
	plugins: WebPlugin[],
	states: PluginInfo[]
): { slug: string; title: string; href: string }[] {
	const enabled = plugins.filter((plugin) => pluginEnabled(plugin.manifest.id, states));
	return orderPlugins(enabled, states).flatMap((plugin) => {
		const slug = pluginSlug(plugin.manifest.id);
		return (plugin.pages ?? [])
			.filter((page) => page.nav)
			.map((page) => ({ slug, title: page.title, href: `/p/${slug}` }));
	});
}

/**
 * visibleNavPages is navPages gated on the loaded plugin states: no
 * plugin link shows before they are ready or when they failed to load,
 * so a plugin the user disabled never flashes in the nav.
 */
export function visibleNavPages(
	plugins: WebPlugin[],
	state: PluginStatesValue
): { slug: string; title: string; href: string }[] {
	return state.status === 'ready' ? navPages(plugins, state.list) : [];
}

/** findPlugin resolves a /p/<slug> segment; disabled or unknown plugins yield undefined. */
export function findPlugin(
	slug: string,
	plugins: WebPlugin[],
	states: PluginInfo[]
): WebPlugin | undefined {
	return plugins.find(
		(plugin) =>
			pluginSlug(plugin.manifest.id) === slug && pluginEnabled(plugin.manifest.id, states)
	);
}
