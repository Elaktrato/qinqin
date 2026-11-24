import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { WidgetDef } from './types';
import { DEFAULT_LAYOUT } from './layout';
import {
	displayItems,
	editableLayout,
	moveWidget,
	moveWidgetTo,
	resetLayout,
	toggleWidget
} from './editor';

const component = (() => null) as unknown as Component;

function widget(id: string, extra: Partial<WidgetDef> = {}): WidgetDef {
	return {
		id,
		title: id.toUpperCase(),
		description: `${id} description`,
		owner: 'core',
		size: 'normal',
		surfaces: ['stats', 'home'],
		component,
		...extra
	};
}

describe('editableLayout', () => {
	it('null is the default layout, as a fresh copy', () => {
		const layout = editableLayout(null);
		expect(layout).toEqual([...DEFAULT_LAYOUT]);
		layout.push('x');
		expect(DEFAULT_LAYOUT).not.toContain('x');
	});

	it('collapses duplicates, keeping the first position', () => {
		expect(editableLayout(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
	});
});

describe('toggleWidget', () => {
	it('turning on appends at the end', () => {
		expect(toggleWidget(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c']);
	});

	it('turning on something already on changes nothing', () => {
		expect(toggleWidget(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
	});

	it('turning off removes it', () => {
		expect(toggleWidget(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c']);
		expect(toggleWidget(['a'], 'z', false)).toEqual(['a']);
	});

	it('starts from the default layout when nothing is stored', () => {
		expect(toggleWidget(null, 'c', true)).toEqual([...DEFAULT_LAYOUT, 'c']);
		expect(toggleWidget(null, 'activity-heatmap', false)).toEqual(['flashcards-summary', 'daily-goal', 'weekly-summary']);
	});

	it('keeps unknown ids and collapses duplicates', () => {
		expect(toggleWidget(['gone', 'a', 'a', 'gone'], 'b', true)).toEqual(['gone', 'a', 'b']);
		expect(toggleWidget(['gone', 'a', 'b'], 'a', false)).toEqual(['gone', 'b']);
	});

	it('does not change its input', () => {
		const stored = ['a', 'b'];
		toggleWidget(stored, 'c', true);
		toggleWidget(stored, 'a', false);
		expect(stored).toEqual(['a', 'b']);
	});
});

describe('moveWidget', () => {
	const all = ['a', 'b', 'c'];

	it('swaps with its neighbour', () => {
		expect(moveWidget(['a', 'b', 'c'], 'b', -1, all)).toEqual(['b', 'a', 'c']);
		expect(moveWidget(['a', 'b', 'c'], 'b', 1, all)).toEqual(['a', 'c', 'b']);
	});

	it('is a no-op at the ends', () => {
		expect(moveWidget(['a', 'b', 'c'], 'a', -1, all)).toEqual(['a', 'b', 'c']);
		expect(moveWidget(['a', 'b', 'c'], 'c', 1, all)).toEqual(['a', 'b', 'c']);
	});

	it('is a no-op for an id that is not on', () => {
		expect(moveWidget(['a', 'b'], 'c', -1, all)).toEqual(['a', 'b']);
	});

	it('steps over unavailable ids, which keep their stored slots', () => {
		// 'gone' belongs to a disabled plugin: it is not listed, so moving
		// 'b' up swaps it with 'a', the previous listed widget.
		expect(moveWidget(['a', 'gone', 'b'], 'b', -1, ['a', 'b'])).toEqual(['b', 'gone', 'a']);
		expect(moveWidget(['gone', 'a', 'b'], 'a', -1, ['a', 'b'])).toEqual(['gone', 'a', 'b']);
		expect(moveWidget(['a', 'b', 'gone'], 'b', 1, ['a', 'b'])).toEqual(['a', 'b', 'gone']);
	});

	it('collapses duplicates and starts from the default', () => {
		expect(moveWidget(['a', 'b', 'a'], 'b', -1, all)).toEqual(['b', 'a']);
		expect(moveWidget(null, 'flashcards-summary', -1, [...DEFAULT_LAYOUT])).toEqual([
			'flashcards-summary',
			'activity-heatmap',
			'daily-goal',
			'weekly-summary'
		]);
	});
});

describe('moveWidgetTo', () => {
	const listed = ['a', 'b', 'c', 'd'];

	it('moves to a position among the listed widgets', () => {
		expect(moveWidgetTo(['a', 'b', 'c', 'd'], 'a', 2, listed)).toEqual(['b', 'c', 'a', 'd']);
		expect(moveWidgetTo(['a', 'b', 'c', 'd'], 'd', 0, listed)).toEqual(['d', 'a', 'b', 'c']);
	});

	it('clamps the target and leaves the same position alone', () => {
		expect(moveWidgetTo(['a', 'b'], 'a', 9, listed)).toEqual(['b', 'a']);
		expect(moveWidgetTo(['a', 'b'], 'b', -3, listed)).toEqual(['b', 'a']);
		expect(moveWidgetTo(['a', 'b'], 'a', 0, listed)).toEqual(['a', 'b']);
	});

	it('keeps unavailable ids in their slots', () => {
		expect(moveWidgetTo(['x', 'a', 'y', 'b', 'c'], 'c', 0, ['a', 'b', 'c'])).toEqual([
			'x',
			'c',
			'y',
			'a',
			'b'
		]);
	});
});

describe('resetLayout', () => {
	it('is the default layout, as a fresh copy', () => {
		const layout = resetLayout();
		expect(layout).toEqual([...DEFAULT_LAYOUT]);
		expect(layout).not.toBe(DEFAULT_LAYOUT);
	});
});

describe('displayItems', () => {
	const heat = widget('activity-heatmap', { size: 'wide' });
	const cards = widget('flashcards-summary', { owner: 'flashcards' });
	const map = widget('map', { appliesTo: (language) => language === 'zh' });
	const statsOnly = widget('stats-only', { surfaces: ['stats'] });
	const all = [heat, cards, map, statsOnly];

	it('lists the on widgets in layout order, then the off ones in registry order', () => {
		const items = displayItems(['map', 'activity-heatmap'], all, 'zh');
		expect(items.map((item) => [item.widget.id, item.on, item.position])).toEqual([
			['map', true, 1],
			['activity-heatmap', true, 2],
			['flashcards-summary', false, null]
		]);
		expect(items[0].onCount).toBe(2);
	});

	it('uses the default layout for null and skips stats-only widgets', () => {
		const items = displayItems(null, all, 'zh');
		expect(items.map((item) => item.widget.id)).toEqual([
			'activity-heatmap',
			'flashcards-summary',
			'map'
		]);
		expect(items.map((item) => item.on)).toEqual([true, true, false]);
	});

	it('marks widgets that do not apply to the language, still on and placed', () => {
		const items = displayItems(['map', 'flashcards-summary'], all, 'es');
		expect(items[0]).toMatchObject({ on: true, position: 1, applies: false });
		expect(items[1]).toMatchObject({ on: true, position: 2, applies: true });
		expect(displayItems(['map'], all, null)[0].applies).toBe(true);
	});

	it('ignores stored ids that are not listed and duplicates', () => {
		const items = displayItems(['gone', 'flashcards-summary', 'gone', 'flashcards-summary'], all, 'zh');
		expect(items.filter((item) => item.on).map((item) => [item.widget.id, item.position])).toEqual([
			['flashcards-summary', 1]
		]);
		expect(items[0].onCount).toBe(1);
	});
});
