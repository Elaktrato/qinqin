import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import { orderPlugins, pluginEnabled, pluginState } from './index';
import type { WebPlugin } from './index';

function plugin(id: string): WebPlugin {
	return {
		manifest: { id, name: id, surfaces: ['home-widget'] },
		component: null as unknown as Component
	};
}

function state(id: string, order: number, enabled = true): PluginInfo {
	return { id, manifest: {}, enabled, order };
}

describe('plugin registry state', () => {
	it('resolves a web id through the server qinqin- alias', () => {
		const serverState = state('qinqin-flashcards', 4, false);

		expect(pluginState('flashcards', [serverState])).toBe(serverState);
		expect(pluginState('qinqin-flashcards', [serverState])).toBe(serverState);
		expect(pluginEnabled('flashcards', [serverState])).toBe(false);
		expect(pluginEnabled('qinqin-flashcards', [serverState])).toBe(false);
	});

	it('treats a plugin without state as enabled at order 0', () => {
		expect(pluginEnabled('qinqin-flashcards', [])).toBe(true);
	});

	it('orders by state ascending and keeps registry order for ties', () => {
		const registry = [plugin('a'), plugin('b'), plugin('c')];

		const ordered = orderPlugins(registry, [
			state('b', 2),
			state('qinqin-c', 1),
			state('a', 1)
		]);

		expect(ordered.map((p) => p.manifest.id)).toEqual(['a', 'c', 'b']);
	});

	it('leaves registry order untouched without any state', () => {
		const registry = [plugin('a'), plugin('b'), plugin('c')];

		expect(orderPlugins(registry, []).map((p) => p.manifest.id)).toEqual(['a', 'b', 'c']);
	});
});
