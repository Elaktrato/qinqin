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
let strokes: () => Response;

const strokePack = {
	packId: 'hanzi-writer-strokes',
	name: 'Hanzi Writer stroke data',
	version: '0.2.0',
	languages: ['zh'],
	license: 'Arphic Public License',
	attribution: 'Make Me a Hanzi, hanzi-writer-data',
	notice: 'Stroke order data derived from Make Me a Hanzi.'
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
	components = () => json([pack]);
	strokes = () => json([strokePack]);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const path = new URL(String(input), 'http://localhost').pathname;
			if (path === '/api/component-packs') return components();
			if (path === '/api/stroke-packs') return strokes();
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

describe('sources page: stroke packs', () => {
	it('lists each stroke pack with licence, attribution, notice and the Arphic text link', async () => {
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Stroke data' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getAllByText('Hanzi Writer stroke data').length).toBeGreaterThan(0));
		expect(within(section).getByText(/Make Me a Hanzi, hanzi-writer-data/)).toBeTruthy();
		expect(within(section).getByText('Stroke order data derived from Make Me a Hanzi.')).toBeTruthy();
		expect(within(section).getByRole('link', { name: 'Arphic Public License' }).getAttribute('href')).toBe('/ARPHICPL.TXT');
	});

	it('no longer lists the stroke data under Built into the app', async () => {
		render(Page);
		const core = screen.getByRole('list', { name: 'Built into the app' });
		expect(within(core).queryByRole('heading', { name: 'hanzi-writer-data' })).toBeNull();
		expect(within(core).getByRole('heading', { name: 'hanzi-writer' })).toBeTruthy();
	});

	it('shows an error with a retry, and hides when no pack is installed', async () => {
		strokes = () => json({ error: 'x', message: 'down' }, 500);
		render(Page);
		const section = (await screen.findByRole('heading', { name: 'Stroke data' })).closest('section')!;
		await waitFor(() => expect(within(section).getByRole('alert')).toBeTruthy());
		cleanup();
		strokes = () => json([]);
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('heading', { name: 'Stroke data' })).toBeNull();
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
