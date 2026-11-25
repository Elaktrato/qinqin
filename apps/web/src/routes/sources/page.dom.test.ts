import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { primaryActions } from '$lib/ui/testing/primary';
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
let lemmaPacks: () => Response;
let strokes: () => Response;
let themesAnswer: () => Response;
let fonts: () => Response;
const fontsAsked = vi.fn();

const fontList = {
	faces: [
		{
			packId: 'klee-one',
			face: 'kai',
			script: 'Jpan',
			original: 'Klee One',
			weight: '400',
			style: 'normal',
			license: 'OFL-1.1',
			attribution: 'Klee One by Fontworks',
			slices: []
		}
	],
	packs: [
		{
			packId: 'klee-one',
			name: 'qinqin Kai JP (Klee One, subset)',
			version: '1.100-q1',
			license: 'OFL-1.1',
			attribution: 'Klee One by Fontworks (SIL OFL 1.1)',
			notice: 'qinqin Kai JP is a modified version of Klee One.'
		}
	]
};

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
	lemmaPacks = () =>
		json([{ packId: 'ja-lemma', name: 'Japanese lemmatizer rules', version: '2026-11-22', language: 'ja', license: 'CC0-1.0', attribution: 'Rule table written for qinqin', notice: '' }]);
	strokes = () => json([strokePack]);
	themesAnswer = () =>
		json({
			themes: [],
			packs: [
				{ packId: 'catppuccin', name: 'Catppuccin', version: '1.0', license: 'MIT', attribution: '© 2021 Catppuccin', notice: '', licenseText: 'MIT License\n\nPermission is hereby granted, free of charge', builtin: true, themes: ['catppuccin-latte'] },
				{ packId: 'paper-themes', name: 'Paper themes', version: '2', license: 'CC0-1.0', attribution: 'Paper', notice: '', builtin: false, themes: [] }
			]
		});
	fonts = () => json(fontList);
	fontsAsked.mockClear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const path = new URL(String(input), 'http://localhost').pathname;
			if (path === '/api/component-packs') return components();
			if (path === '/api/lemma-packs') return lemmaPacks();
			if (path === '/api/stroke-packs') return strokes();
			if (path === '/api/themes') return themesAnswer();
			if (path === '/api/fonts') {
				fontsAsked();
				return fonts();
			}
			return json([]);
		})
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.removeItem('qinqin.token');
});

describe('sources in the lighter look (#106)', () => {
	const source = readFileSync(join(__dirname, '+page.svelte'), 'utf8');
	const css = source.slice(source.indexOf('<style>'));

	it('every table is a .ui-table inside a named scroll region, and no view has a primary action', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		render(Page);
		await screen.findByRole('heading', { name: 'Themes' });
		await waitFor(() => expect(document.querySelectorAll('table').length).toBeGreaterThan(2));
		for (const table of document.querySelectorAll('table')) {
			expect(table.classList.contains('ui-table')).toBe(true);
			expect(table.querySelector('th[scope="col"]')).toBeTruthy();
		}
		for (const wrap of document.querySelectorAll('.table-wrap')) {
			expect(wrap.getAttribute('tabindex')).toBe('0');
			expect(wrap.getAttribute('role')).toBe('region');
			expect(wrap.getAttribute('aria-labelledby')).toBeTruthy();
		}
		expect(primaryActions(document.body)).toHaveLength(0);
	});

	it('keeps the sections and their ids in today\'s order', async () => {
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		const ids = [...document.querySelectorAll('section h2[id]')].map((h) => h.id);
		const order = ['sources-dictionaries', 'sources-frequency', 'sources-levels', 'sources-grammar', 'sources-core'];
		const seen = ids.filter((id) => order.includes(id));
		expect(seen).toEqual(order);
	});

	it('links are underlined reading-colour text links, tables have no box, credits are hairline rows', () => {
		expect(css).toMatch(/a\s*\{[^}]*color:\s*var\(--reading-accent\)/);
		expect(css).toMatch(/a\s*\{[^}]*text-decoration:\s*underline/);
		expect(css).not.toMatch(/text-transform:\s*uppercase/);
		expect(css).toMatch(/\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
		expect(css).not.toMatch(/\.table-wrap\s*\{[^}]*border:/);
		expect(css).toMatch(/\.credit\s*\+\s*\.credit\s*\{[^}]*border-top:\s*1px solid var\(--hair\)/);
		expect(css).toMatch(/\.notes dd\s*\{[^}]*border-inline-start:\s*1px solid var\(--hair\)/);
	});
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

describe('sources page: lemmatizer rules', () => {
	it('lists each rule-table pack with its licence and attribution', async () => {
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Lemmatizer rules' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getAllByText('Japanese lemmatizer rules').length).toBeGreaterThan(0));
		expect(within(section).getByText('CC0-1.0')).toBeTruthy();
		expect(within(section).getByText('Rule table written for qinqin')).toBeTruthy();
	});

	it('shows an error line with a retry on failure', async () => {
		lemmaPacks = () => json({ error: 'x', message: 'down' }, 500);
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Lemmatizer rules' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getByRole('alert')).toBeTruthy());
		lemmaPacks = () => json([]);
		await fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(screen.queryByRole('heading', { name: 'Lemmatizer rules' })).toBeNull());
	});

	it('is hidden when no rule-table pack is installed', async () => {
		lemmaPacks = () => json([]);
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('heading', { name: 'Lemmatizer rules' })).toBeNull();
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

describe('sources page: font packs', () => {
	it('credits each installed font pack for a signed-in visitor, with the face it modifies', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Fonts' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getAllByText('qinqin Kai JP (Klee One, subset)').length).toBeGreaterThan(0));
		expect(within(section).getByRole('link', { name: 'OFL-1.1' }).getAttribute('href')).toBe('https://openfontlicense.org/');
		expect(within(section).getByText('qinqin Kai JP is a modified version of Klee One.')).toBeTruthy();
		expect(within(section).getByText(/a modified \(subset, renamed\) version of Klee One/)).toBeTruthy();
	});

	it('asks nothing and shows nothing when signed out (the list needs a session)', async () => {
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		await new Promise((r) => setTimeout(r, 0));
		expect(fontsAsked).not.toHaveBeenCalled();
		expect(screen.queryByRole('heading', { name: 'Fonts' })).toBeNull();
	});

	it('is hidden when no font pack is installed', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		fonts = () => json({ faces: [], packs: [] });
		render(Page);
		await screen.findByRole('heading', { name: 'Frequency lists' });
		await waitFor(() => expect(fontsAsked).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('heading', { name: 'Fonts' })).toBeNull();
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

describe('sources page: themes', () => {
	it('credits every theme pack, the built-in ones marked', async () => {
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Themes' });
		const section = heading.closest('section')!;
		await waitFor(() => expect(within(section).getByText('Paper themes')).toBeTruthy());
		const builtin = within(section).getByRole('row', { name: /Catppuccin/ });
		expect(within(builtin).getByText('Built into the app')).toBeTruthy();
		const installed = within(section).getByRole('row', { name: /Paper themes/ });
		expect(within(installed).getByText('Installed on this server')).toBeTruthy();
		expect(within(installed).getByText('CC0-1.0')).toBeTruthy();
		// The built-in pack's full licence text, behind a disclosure.
		const summary = within(section).getByText('Catppuccin: MIT license text');
		expect(summary.tagName).toBe('SUMMARY');
		expect(summary.closest('details')!.textContent).toContain('Permission is hereby granted, free of charge');
		expect(within(section).queryByText(/Paper themes: .* license text/)).toBeNull();
	});

	it('shows an error line with a retry on failure', async () => {
		themesAnswer = () => json({ error: 'x', message: 'down' }, 500);
		render(Page);
		const heading = await screen.findByRole('heading', { name: 'Themes' });
		await waitFor(() => expect(within(heading.closest('section')!).getByRole('alert')).toBeTruthy());
	});
});
