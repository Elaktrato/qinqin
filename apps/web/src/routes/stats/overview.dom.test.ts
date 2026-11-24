import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import type { WidgetDef } from '$lib/widgets/types';

vi.mock('$lib/widgets/registry', () => ({ allWidgets: vi.fn(() => []) }));

import { allWidgets } from '$lib/widgets/registry';
import { pluginStates } from '$lib/plugins/states';
import StubWidget from './StubWidget.svelte';
import Page from './+page.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const component = StubWidget as unknown as Component;

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

const registry: WidgetDef[] = [
	widget('activity-heatmap', 'core', { size: 'wide' }),
	widget('character-map-summary', 'core'),
	widget('summary-numbers', 'core', { size: 'wide' }),
	widget('word-states', 'qinqin-flashcards'),
	widget('flashcards-summary', 'qinqin-flashcards'),
	widget('reviews-per-day', 'core', { size: 'wide' }),
	widget('reading-time', 'qinqin-reader'),
	widget('plugin-widget', 'qinqin-plugin')
];

const ids = () => [...document.querySelectorAll<HTMLElement>('[data-widget]')].map((el) => el.dataset.widget);

beforeEach(() => {
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'Chinese' } as never });
	pluginStates.set({ list: [], status: 'ready' });
	vi.mocked(allWidgets).mockReturnValue(registry);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
	pluginStates.set({ list: [], status: 'idle' });
});

describe('Stats → Overview', () => {
	it('renders summary-numbers first and reviews-per-day after the flashcards summary', () => {
		render(Page, { context: ctx.context });

		expect(ids()).toEqual([
			'summary-numbers',
			'word-states',
			'flashcards-summary',
			'reviews-per-day',
			'activity-heatmap',
			'character-map-summary',
			'reading-time',
			'plugin-widget'
		]);
	});
});
