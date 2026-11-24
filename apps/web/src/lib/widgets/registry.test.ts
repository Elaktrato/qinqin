import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import ActivityHome from './ActivityHome.svelte';
import { DEFAULT_LAYOUT } from './layout';
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

function state(id: string, enabled = true): FeatureSwitch {
	return { id, enabled };
}

const core = [widget('core-a', 'core'), widget('core-han', 'core', { appliesTo: (l) => l === 'zh' }), widget('core-a', 'other')];

const ids = (list: WidgetDef[]) => list.map((w) => w.id);

describe('allWidgets', () => {
	it('applies appliesTo for a set language and skips the filter without one', () => {
		expect(ids(allWidgets([], 'es', core))).not.toContain('core-han');
		expect(ids(allWidgets([], 'zh', core))).toContain('core-han');
		expect(ids(allWidgets([], null, core))).toContain('core-han');
	});

	it('keeps the first widget of a duplicated id', () => {
		const list = allWidgets([], null, core);
		expect(ids(list)).toEqual(['core-a', 'core-han']);
		expect(list[0].owner).toBe('core');
	});

	it('registers the shipped core and feature widgets', () => {
		const list = allWidgets([state('flashcards'), state('reader')], 'zh');

		expect(ids(list)).toEqual([
			'activity-heatmap',
			'character-map-summary',
			'daily-goal',
			'summary-numbers',
			'reviews-per-day',
			'weekly-summary',
			'flashcards-summary',
			'word-states',
			'reading-time'
		]);
		expect(list.map((w) => [w.owner, w.size])).toEqual([
			['core', 'wide'],
			['core', 'normal'],
			['core', 'normal'],
			['core', 'wide'],
			['core', 'wide'],
			['core', 'normal'],
			['flashcards', 'normal'],
			['flashcards', 'normal'],
			['reader', 'normal']
		]);
		// The reader has no state row here: its widget stays away, as in v0.3.0.
		expect(ids(allWidgets([state('flashcards', false)], 'zh'))).toEqual([
			'activity-heatmap',
			'character-map-summary',
			'daily-goal',
			'summary-numbers',
			'reviews-per-day',
			'weekly-summary'
		]);
	});

	it('summary-numbers is core, wide, on Stats and Home, not in the default home layout', () => {
		const list = allWidgets([state('flashcards')], 'zh');
		const summary = list.find((w) => w.id === 'summary-numbers')!;
		expect(summary).toMatchObject({
			title: 'Summary',
			owner: 'core',
			size: 'wide',
			surfaces: ['stats', 'home']
		});
		expect(DEFAULT_LAYOUT).not.toContain('summary-numbers');
	});

	it('reviews-per-day is core, wide, on Stats and Home, not in the default home layout', () => {
		const list = allWidgets([state('flashcards')], 'zh');
		const reviews = list.find((w) => w.id === 'reviews-per-day')!;
		expect(reviews).toMatchObject({
			title: 'Reviews per day',
			owner: 'core',
			size: 'wide',
			surfaces: ['stats', 'home']
		});
		expect(DEFAULT_LAYOUT).not.toContain('reviews-per-day');
	});

	it('offers this week on the home page only (Stats has the Week tab)', () => {
		const list = allWidgets([state('flashcards')], 'es');
		expect(list.find((w) => w.id === 'weekly-summary')).toMatchObject({
			title: 'This week',
			owner: 'core',
			size: 'normal',
			surfaces: ['home']
		});
	});

	it('the activity heatmap has a home component (the chosen layout); Stats keeps the garden', () => {
		const heatmap = allWidgets([], 'zh').find((w) => w.id === 'activity-heatmap')!;
		expect(heatmap.homeComponent).toBe(ActivityHome);
		expect(heatmap.component).toBe(ActivityHeatmap);
		expect(heatmap.homeComponent).not.toBe(heatmap.component);
	});

	it('offers the daily goal on the home page only (not Stats)', () => {
		const list = allWidgets([state('flashcards')], 'zh');
		expect(list.find((w) => w.id === 'daily-goal')?.surfaces).toEqual(['home']);
	});

	it('shows the character map tile for Han languages only', () => {
		const states = [state('flashcards'), state('reader')];

		expect(ids(allWidgets(states, 'ja'))).toContain('character-map-summary');
		expect(ids(allWidgets(states, 'zh-TW'))).toContain('character-map-summary');
		expect(ids(allWidgets(states, 'es'))).not.toContain('character-map-summary');
	});
});
