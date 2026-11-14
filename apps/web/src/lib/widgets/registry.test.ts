import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import type { WebPlugin } from '$lib/plugins';
import { webPlugins } from '$lib/plugins';
import { allWidgets } from './registry';
import type { WidgetDef } from './types';

const component = null as unknown as Component;

function widget(id: string, owner: string, extra: Partial<WidgetDef> = {}): WidgetDef {
	return {
		id,
		title: id,
		description: id,
		owner,
		size: 'normal',
		surfaces: ['stats', 'home'],
		component,
		...extra
	};
}

function plugin(id: string, widgets: WidgetDef[]): WebPlugin {
	return { manifest: { id, name: id, surfaces: [], widgets } };
}

function state(id: string, enabled = true): PluginInfo {
	return { id, manifest: {}, enabled, order: 0 };
}

const core = [widget('core-a', 'core'), widget('core-han', 'core', { appliesTo: (l) => l === 'zh' })];
const registry = [
	plugin('qinqin-b', [widget('b-1', 'qinqin-b'), widget('b-2', 'qinqin-b')]),
	plugin('qinqin-c', [widget('c-1', 'qinqin-c')])
];

const ids = (list: WidgetDef[]) => list.map((w) => w.id);

describe('allWidgets', () => {
	it('lists core widgets first, then plugin widgets in registry order', () => {
		const states = [state('qinqin-c'), state('qinqin-b')];

		expect(ids(allWidgets(registry, states, null, core))).toEqual([
			'core-a',
			'core-han',
			'b-1',
			'b-2',
			'c-1'
		]);
	});

	it('drops the widgets of a disabled plugin', () => {
		const states = [state('qinqin-b', false), state('qinqin-c')];

		expect(ids(allWidgets(registry, states, null, core))).toEqual(['core-a', 'core-han', 'c-1']);
	});

	it('drops the widgets of a plugin the server does not list (not installed)', () => {
		expect(ids(allWidgets(registry, [state('qinqin-c')], null, core))).toEqual([
			'core-a',
			'core-han',
			'c-1'
		]);
	});

	it('shows only core widgets while no plugin states are known', () => {
		expect(ids(allWidgets(registry, [], null, core))).toEqual(['core-a', 'core-han']);
	});

	it('resolves a short web plugin id through the server qinqin- alias', () => {
		const short = [plugin('e', [widget('e-1', 'e')])];

		expect(ids(allWidgets(short, [state('qinqin-e')], null, core))).toContain('e-1');
		expect(ids(allWidgets(short, [state('qinqin-e', false)], null, core))).not.toContain('e-1');
	});

	it('applies appliesTo for a set language and skips the filter without one', () => {
		const states = [state('qinqin-b'), state('qinqin-c')];

		expect(ids(allWidgets(registry, states, 'es', core))).not.toContain('core-han');
		expect(ids(allWidgets(registry, states, 'zh', core))).toContain('core-han');
		expect(ids(allWidgets(registry, states, null, core))).toContain('core-han');
	});

	it('keeps the first widget of a duplicated id', () => {
		const dup = [plugin('qinqin-d', [widget('core-a', 'qinqin-d'), widget('d-1', 'qinqin-d')])];

		const list = allWidgets(dup, [state('qinqin-d')], null, core);

		expect(ids(list)).toEqual(['core-a', 'core-han', 'd-1']);
		expect(list[0].owner).toBe('core');
	});

	it('registers the shipped core and plugin widgets', () => {
		const list = allWidgets(webPlugins, [state('qinqin-flashcards'), state('qinqin-reader')], 'zh');

		expect(ids(list)).toEqual([
			'activity-heatmap',
			'flashcards-summary',
			'word-states',
			'reading-time'
		]);
		expect(list.map((w) => [w.owner, w.size])).toEqual([
			['core', 'wide'],
			['qinqin-flashcards', 'normal'],
			['qinqin-flashcards', 'normal'],
			['qinqin-reader', 'normal']
		]);
		expect(ids(allWidgets(webPlugins, [state('qinqin-flashcards', false)], 'zh'))).toEqual([
			'activity-heatmap'
		]);
	});
});
