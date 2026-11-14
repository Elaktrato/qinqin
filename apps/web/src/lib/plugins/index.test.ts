import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import { findPlugin, homeWidgets, isCorePlugin, navPages, webPlugins, orderPlugins, pluginEnabled, pluginSlug, pluginState, visibleNavPages } from './index';
import type { WebPlugin } from './index';

function plugin(id: string): WebPlugin {
	return { manifest: { id, name: id, surfaces: ['home-widget'] } };
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

function pagePlugin(id: string, nav: boolean | undefined, title = id): WebPlugin {
	return {
		...plugin(id),
		pages: [{ title, nav, component: null as unknown as Component<{ rest: string }> }]
	};
}

describe('plugin pages', () => {
	it('derives the slug by stripping the qinqin- prefix', () => {
		expect(pluginSlug('qinqin-reader')).toBe('reader');
		expect(pluginSlug('reader')).toBe('reader');
	});

	it('lists only enabled nav pages in plugin order', () => {
		const registry = [
			pagePlugin('qinqin-b', true, 'B'),
			pagePlugin('qinqin-a', true, 'A'),
			pagePlugin('qinqin-hidden', false),
			pagePlugin('qinqin-off', true),
			plugin('qinqin-nopages')
		];

		const links = navPages(registry, [
			state('qinqin-b', 2),
			state('qinqin-a', 1),
			state('qinqin-off', 3, false)
		]);

		expect(links).toEqual([
			{ slug: 'a', title: 'A', href: '/p/a' },
			{ slug: 'b', title: 'B', href: '/p/b' }
		]);
	});

	it('finds an enabled plugin by slug and hides disabled or unknown ones', () => {
		const registry = [pagePlugin('qinqin-reader', true), pagePlugin('qinqin-off', true)];
		const states = [state('qinqin-off', 1, false)];

		expect(findPlugin('reader', registry, states)).toBe(registry[0]);
		expect(findPlugin('off', registry, states)).toBeUndefined();
		expect(findPlugin('nope', registry, states)).toBeUndefined();
	});
});

describe('reader registration', () => {
	it('shows the Reader nav link when enabled and hides it when disabled', () => {
		expect(navPages(webPlugins, []).filter((link) => link.href === '/p/reader')).toEqual([
			{ slug: 'reader', title: 'Reader', href: '/p/reader' }
		]);
		expect(navPages(webPlugins, [state('qinqin-reader', 0, false)])).toEqual([]);
	});

	it('keeps page-only plugins out of the home widget slot', () => {
		const ids = homeWidgets(webPlugins, []).map((p) => p.manifest.id);

		expect(ids).toEqual(['qinqin-flashcards']);
	});

	it('gives the page-only reader no widgets', () => {
		const reader = webPlugins.find((p) => p.manifest.id === 'qinqin-reader');

		expect(reader?.manifest.widgets ?? []).toEqual([]);
	});
});

describe('isCorePlugin', () => {
	it('recognises only the core app registry row', () => {
		expect(isCorePlugin('qinqin-core')).toBe(true);
		expect(isCorePlugin('qinqin-flashcards')).toBe(false);
		expect(isCorePlugin('core')).toBe(false);
	});
});

describe('visibleNavPages', () => {
	it('shows no plugin link until the states are loaded', () => {
		for (const status of ['idle', 'loading', 'error'] as const) {
			expect(visibleNavPages(webPlugins, { list: [], status })).toEqual([]);
		}
	});

	it('shows the links of enabled plugins once ready', () => {
		expect(visibleNavPages(webPlugins, { list: [], status: 'ready' }).map((l) => l.href)).toContain(
			'/p/reader'
		);
		expect(
			visibleNavPages(webPlugins, {
				list: [state('qinqin-reader', 0, false)],
				status: 'ready'
			}).map((l) => l.href)
		).not.toContain('/p/reader');
	});
});
