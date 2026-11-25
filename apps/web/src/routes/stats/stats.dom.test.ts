import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));

import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const view = createRawSnippet(() => ({ render: () => '<p>the view</p>' }));

function mount(path: string, language: string | null) {
	setUrl(path);
	ctx.session.workspaces.set({
		list: [],
		current: language === null ? null : ({ id: 1, language, name: 'w1' } as never)
	});
	return render(Layout, { props: { children: view }, context: ctx.context });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
	cleanup();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('Stats layout tabs', () => {
	it('the stats tabs are a nav of links named by stats.tabsLabel, the current one aria-current="page"', () => {
		mount('/stats', 'zh');

		const nav = screen.getByRole('navigation', { name: 'Stats views' });
		const links = within(nav).getAllByRole('link');
		expect(links.map((link) => link.textContent)).toEqual(['Overview', 'Week', 'Characters']);
		expect(links.map((link) => link.getAttribute('href'))).toEqual([
			'/stats',
			'/stats/week',
			'/stats/characters'
		]);
		expect(links[0].getAttribute('aria-current')).toBe('page');
		expect(links[1].getAttribute('aria-current')).toBeNull();
		expect(links.every((link) => link.hasAttribute('data-sveltekit-keepfocus'))).toBe(true);
		expect(links.every((link) => link.hasAttribute('data-sveltekit-noscroll'))).toBe(true);
		// A link that navigates is not an ARIA tab.
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByRole('tab')).toBeNull();
	});

	it('keeps the h1 and names the panel region after the current tab', () => {
		mount('/stats/week', 'zh');

		expect(screen.getByRole('heading', { level: 1, name: 'Stats' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Week' })).toBeTruthy();
		expect(screen.getByText('the view')).toBeTruthy();
	});

	it('Characters is absent in a Spanish workspace and a direct visit keeps its region', () => {
		mount('/stats/characters', 'es');

		const nav = screen.getByRole('navigation', { name: 'Stats views' });
		expect(within(nav).queryByRole('link', { name: 'Characters' })).toBeNull();
		expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Overview', 'Week']);
		expect(within(nav).queryByRole('link', { current: 'page' })).toBeNull();
		// The layout keeps a region named after the view the URL asked for; the
		// Characters page's own not-Han note is tested in characters/page.dom.test.ts.
		expect(screen.getByRole('region', { name: 'Characters' })).toBeTruthy();
		expect(screen.getByText('the view')).toBeTruthy();
	});

	it('with no workspace only Overview is offered', () => {
		mount('/stats', null);
		const nav = screen.getByRole('navigation', { name: 'Stats views' });
		expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Overview']);
	});
});
