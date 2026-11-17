import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import Page from './+page.svelte';

const pack = {
	packId: 'kanjivg-components',
	name: 'KanjiVG components',
	version: 'r20260714',
	language: 'ja',
	license: 'CC BY-SA 3.0',
	attribution: 'KanjiVG © Ulrich Apel (https://kanjivg.tagaini.net)',
	notice: 'A component index derived from KanjiVG.'
};

let components: () => Response;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
	components = () => json([pack]);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const path = new URL(String(input), 'http://localhost').pathname;
			if (path === '/api/component-packs') return components();
			return json([]);
		})
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('sources page: character components', () => {
	it('lists the pack with its licence, attribution and notice', async () => {
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Character components' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getAllByText('KanjiVG components').length).toBeGreaterThan(0));
		expect(within(section).getByText('CC BY-SA 3.0')).toBeTruthy();
		expect(within(section).getByText(/Ulrich Apel/)).toBeTruthy();
		expect(within(section).getByText('A component index derived from KanjiVG.')).toBeTruthy();
	});

	it('shows an error line with a retry on failure', async () => {
		components = () => json({ error: 'x', message: 'down' }, 500);
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Character components' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getByRole('alert')).toBeTruthy());
		components = () => json([pack]);
		await fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
		await waitFor(() => {
			const again = screen.getByRole('heading', { name: 'Character components' }).closest('section')!;
			expect(within(again).getAllByText('KanjiVG components').length).toBeGreaterThan(0);
		});
	});

	it('is hidden when no components pack is installed', async () => {
		components = () => json([]);
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('heading', { name: 'Character components' })).toBeNull();
	});
});

describe('sources page: the reader sources are core credits (v0.4.0)', () => {
	it('lists Aozora Bunko, Project Gutenberg and opencc-js under Built into the app, with both opencc licence texts', async () => {
		render(Page);
		const core = screen.getByRole('list', { name: 'Built into the app' });
		for (const name of ['Aozora Bunko', 'Project Gutenberg', 'opencc-js']) {
			expect(within(core).getByRole('heading', { name })).toBeTruthy();
		}
		const mit = within(core).getAllByRole('link', { name: 'MIT license text' }).map((a) => a.getAttribute('href'));
		expect(mit).toContain('/OPENCC-JS-LICENSE.TXT');
		expect(within(core).getByRole('link', { name: 'Apache-2.0 license text' }).getAttribute('href')).toBe('/OPENCC-APACHE-2.0.TXT');
		// No plugin section for the reader any more.
		expect(screen.queryByRole('list', { name: 'Reader sources' })).toBeNull();
	});
});
