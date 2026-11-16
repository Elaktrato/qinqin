import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', async () => {
	const state = await import('$lib/testing/appState.svelte');
	return {
		goto: vi.fn((href: string) => {
			state.setUrl(href);
			return Promise.resolve();
		})
	};
});
vi.mock('$lib/api/characters', () => ({ fetchCharacters: vi.fn() }));
vi.mock('$lib/api/components', () => ({ fetchComponents: vi.fn() }));

import { fetchCharacters } from '$lib/api/characters';
import { fetchComponents } from '$lib/api/components';
import type { CharRow } from '$lib/api/types';
import { page, setUrl } from '$lib/testing/appState.svelte';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

const chars: CharRow[] = [
	{ i: 1, c: '海', s: 9, k: 85 },
	{ i: 2, c: '河', s: 8, k: 85 },
	{ i: 3, c: '池', s: 6, k: 85 },
	{ i: 4, c: '語', s: 14, k: 149 },
	{ i: 5, c: '話', s: 13, k: 149 },
	{ i: 9, c: '沽', s: 8, k: 85 }
];
const components = {
	packs: [],
	parts: [
		{ c: '氵', s: 3, n: 12 },
		{ c: '口', s: 3, n: 40 },
		{ c: '言', s: 7, n: 11 },
		{ c: '古', s: 5, n: 10 },
		{ c: '可', s: 5, n: 3 }
	],
	chars: {
		海: ['氵', '每'],
		河: ['氵', '可', '口'],
		池: ['氵', '也'],
		語: ['言', '口', '吾'],
		話: ['言', '舌', '口'],
		沽: ['氵', '古', '口']
	}
};

function workspace(language: string): void {
	workspaces.set({ list: [], current: { id: 1, language, name: language } as never });
}

function cells(): string[] {
	const grid = screen.queryByRole('list', { name: 'Matching characters' });
	return grid ? within(grid).queryAllByRole('link').map((a) => a.textContent ?? '') : [];
}

beforeEach(() => {
	setUrl('/search/parts');
	workspace('ja');
	vi.mocked(fetchCharacters).mockResolvedValue({ chars, count: chars.length });
	vi.mocked(fetchComponents).mockResolvedValue(components);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('radical and part lookup page', () => {
	it('shows 17 stroke groups, the parts picker and no results before a pick', async () => {
		render(Page);
		const table = await screen.findByRole('group', { name: 'Radicals' });
		expect(within(table).getAllByRole('heading')).toHaveLength(17);
		expect(await screen.findByRole('group', { name: 'Parts' })).toBeTruthy();
		expect(cells()).toEqual([]);
		expect(screen.getByRole('status').textContent).toBe('');
		expect(fetchCharacters).toHaveBeenCalledWith('ja');
		expect(document.title).toBe('Radicals and parts · qinqin');
	});

	it('clicking 氵 sets ?r=85 and lists the cells grouped by strokes', async () => {
		render(Page);
		const water = await screen.findByRole('button', { name: /^水/ });
		expect(water.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(water);
		expect(page.url.search).toBe('?r=85');
		await waitFor(() => expect(cells()).toEqual(['池', '河', '沽', '海']));
		expect(screen.getByRole('status').textContent).toBe('4 characters');
		expect(screen.getByRole('heading', { name: '8 strokes' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^水/ }).getAttribute('aria-pressed')).toBe('true');
		const link = screen.getByRole('link', { name: '河' });
		expect(link.getAttribute('href')).toBe('/entry/2');
	});

	it('picking a part narrows and disables impossible parts; strokes narrow; Clear resets', async () => {
		setUrl('/search/parts?r=85');
		render(Page);
		await waitFor(() => expect(cells()).toHaveLength(4));
		const parts = screen.getByRole('group', { name: 'Parts' });
		await fireEvent.click(within(parts).getByRole('button', { name: '口' }));
		await waitFor(() => expect(cells()).toEqual(['河', '沽']));
		expect(page.url.searchParams.getAll('p')).toEqual(['口']);
		expect(within(parts).getByRole('button', { name: '言' }).getAttribute('aria-disabled')).toBe('true');
		expect(within(parts).getByRole('button', { name: '古' }).getAttribute('aria-disabled')).toBe('false');
		expect(within(parts).getByRole('button', { name: '口' }).getAttribute('aria-pressed')).toBe('true');

		const strokes = screen.getByRole('group', { name: 'Total strokes' });
		expect(within(strokes).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['8']);

		await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
		expect(page.url.search).toBe('');
		await waitFor(() => expect(cells()).toEqual([]));
	});

	it('stroke chips narrow the result', async () => {
		setUrl('/search/parts?r=85');
		render(Page);
		await waitFor(() => expect(cells()).toHaveLength(4));
		const strokes = screen.getByRole('group', { name: 'Total strokes' });
		await fireEvent.click(within(strokes).getByRole('button', { name: '9' }));
		await waitFor(() => expect(cells()).toEqual(['海']));
		expect(page.url.searchParams.get('s')).toBe('9');
	});

	it('"Show all parts" lifts the use threshold', async () => {
		render(Page);
		const parts = await screen.findByRole('group', { name: 'Parts' });
		expect(within(parts).queryByRole('button', { name: '可' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Show all parts' }));
		expect(within(parts).getByRole('button', { name: '可' })).toBeTruthy();
	});

	it('chosen parts the picker hides are shown as removable chips', async () => {
		setUrl('/search/parts?r=85&p=%E5%8F%AF');
		render(Page);
		await waitFor(() => expect(cells()).toEqual(['河']));
		const parts = screen.getByRole('group', { name: 'Parts' });
		expect(within(parts).queryByRole('button', { name: '可' })).toBeNull();
		const chosen = screen.getByRole('group', { name: 'Selected' });
		expect(within(chosen).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
			'Remove radical 水 (85)',
			'Remove part 可'
		]);
		await fireEvent.click(within(chosen).getByRole('button', { name: 'Remove part 可' }));
		expect(page.url.search).toBe('?r=85');
		await waitFor(() => expect(cells()).toHaveLength(4));
	});

	it('a typed 氵 selects radical 85; a typed part adds it', async () => {
		render(Page);
		const input = await screen.findByLabelText('Type a radical or part');
		await fireEvent.input(input, { target: { value: '氵' } });
		await fireEvent.submit(input.closest('form')!);
		expect(page.url.search).toBe('?r=85');
		await fireEvent.input(input, { target: { value: '古' } });
		await fireEvent.submit(input.closest('form')!);
		await waitFor(() => expect(cells()).toEqual(['沽']));
	});

	it('a typed 阝 asks which one and finds the left-side characters', async () => {
		vi.mocked(fetchCharacters).mockResolvedValue({
			chars: [...chars, { i: 20, c: '陽', s: 12, k: 170 }, { i: 21, c: '都', s: 11, k: 163 }],
			count: chars.length + 2
		});
		vi.mocked(fetchComponents).mockResolvedValue({
			packs: [],
			parts: [...components.parts, { c: '⻖', s: 3, n: 30 }, { c: '⻏', s: 3, n: 20 }],
			chars: { ...components.chars, 陽: ['⻖', '昜'], 都: ['者', '⻏'] }
		});
		render(Page);
		const input = await screen.findByLabelText('Type a radical or part');
		await fireEvent.input(input, { target: { value: '阝' } });
		await fireEvent.submit(input.closest('form')!);
		const which = screen.getByRole('group', { name: 'Which one?' });
		expect(within(which).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
			'radical 邑 (163)',
			'radical 阜 (170)',
			'part ⻏',
			'part ⻖'
		]);
		await fireEvent.click(within(which).getByRole('button', { name: 'part ⻖' }));
		expect(page.url.searchParams.getAll('p')).toEqual(['⻖']);
		await waitFor(() => expect(cells()).toEqual(['陽']));
		expect(screen.queryByRole('group', { name: 'Which one?' })).toBeNull();
	});

	it('a zh workspace without components shows no parts picker but a note', async () => {
		workspace('zh-TW');
		vi.mocked(fetchComponents).mockResolvedValue({ packs: [], parts: [], chars: {} });
		render(Page);
		await screen.findByRole('group', { name: 'Radicals' });
		expect(fetchCharacters).toHaveBeenCalledWith('zh-TW');
		expect(screen.queryByRole('group', { name: 'Parts' })).toBeNull();
		expect(screen.getByText(/No character components are installed/)).toBeTruthy();
		// zh shows the simplified forms on the tiles.
		expect(screen.getByRole('button', { name: /^言/ }).textContent).toContain('讠');
	});

	it('a failed components request still shows the radical table, without parts', async () => {
		vi.mocked(fetchComponents).mockRejectedValue(new Error('components down'));
		setUrl('/search/parts?r=85');
		render(Page);
		expect(await screen.findByRole('group', { name: 'Radicals' })).toBeTruthy();
		await waitFor(() => expect(cells()).toEqual(['池', '河', '沽', '海']));
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.queryByRole('group', { name: 'Parts' })).toBeNull();
		expect(screen.getByText(/No character components are installed/)).toBeTruthy();
	});

	it('a language without a character universe says so', async () => {
		workspace('es');
		render(Page);
		expect(await screen.findByText('Radical lookup is available in Chinese and Japanese workspaces.')).toBeTruthy();
		expect(fetchCharacters).not.toHaveBeenCalled();
	});

	it('an empty universe shows the dictionary hint', async () => {
		vi.mocked(fetchCharacters).mockResolvedValue({ chars: [], count: 0 });
		render(Page);
		expect(await screen.findByText(/dictionary/i)).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Radicals' })).toBeNull();
	});

	it('a load error shows a retry that reloads', async () => {
		vi.mocked(fetchCharacters).mockRejectedValueOnce(new Error('down'));
		render(Page);
		expect((await screen.findByRole('alert')).textContent).toContain('down');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('group', { name: 'Radicals' })).toBeTruthy();
		expect(fetchCharacters).toHaveBeenCalledTimes(2);
	});

	it('more than 300 results show "Show all N"', async () => {
		const many: CharRow[] = Array.from({ length: 301 }, (_, j) => ({ i: 100 + j, c: String.fromCodePoint(0x4e00 + j), s: 1, k: 1 }));
		vi.mocked(fetchCharacters).mockResolvedValue({ chars: many, count: many.length });
		setUrl('/search/parts?r=1');
		render(Page);
		await waitFor(() => expect(cells()).toHaveLength(300));
		expect(screen.getByRole('status').textContent).toBe('301 characters');
		await fireEvent.click(screen.getByRole('button', { name: 'Show all 301' }));
		await waitFor(() => expect(cells()).toHaveLength(301));
	});
});
