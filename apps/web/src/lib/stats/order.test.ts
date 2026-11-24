import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { WidgetDef } from '$lib/widgets/types';
import { STATS_ORDER, statsOrder } from './order';

const component = null as unknown as Component;

function widget(id: string, owner = 'core'): WidgetDef {
	return { id, title: id, description: id, owner, size: 'normal', surfaces: ['stats'], component };
}

const ids = (list: WidgetDef[]) => list.map((widget) => widget.id);

describe('statsOrder', () => {
	it('puts the default ids first in the design order', () => {
		const registry = [
			'reading-time',
			'character-map-summary',
			'activity-heatmap',
			'reviews-per-day',
			'flashcards-summary',
			'word-states',
			'summary-numbers'
		].map((id) => widget(id));

		expect(ids(statsOrder(registry))).toEqual([...STATS_ORDER]);
	});

	it('keeps a plugin widget that declares stats after them, in registry order', () => {
		const registry = [
			widget('summary-numbers'),
			widget('plugin-b', 'qinqin-b'),
			widget('reviews-per-day'),
			widget('plugin-a', 'qinqin-a'),
			widget('word-states', 'flashcards')
		];

		expect(ids(statsOrder(registry))).toEqual([
			'summary-numbers',
			'word-states',
			'reviews-per-day',
			'plugin-b',
			'plugin-a'
		]);
	});

	it('ignores missing defaults (Characters summary in a Spanish workspace)', () => {
		const registry = [
			widget('summary-numbers'),
			widget('word-states', 'flashcards'),
			widget('plugin-a', 'qinqin-a')
		];

		expect(ids(statsOrder(registry))).toEqual(['summary-numbers', 'word-states', 'plugin-a']);
	});

	it('keeps a duplicated id once (the registry already dropped duplicates)', () => {
		const a = widget('summary-numbers');
		const b = widget('summary-numbers', 'qinqin-b');

		expect(statsOrder([a, b])).toEqual([a]);
	});
});
