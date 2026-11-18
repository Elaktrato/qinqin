import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/characters', () => ({ fetchCharacters: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ fetchSchemeCharacters: vi.fn(), getSchemes: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/study/entriesCache', () => ({
	fillMissingWrittenProgressively: vi.fn(async (cards: unknown[]) => ({ cards, unresolvedCards: 0 }))
}));
vi.mock('$lib/study/mastery', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/mastery')>()),
	masteryForChars: vi.fn()
}));

import { fetchCharacters } from '$lib/api/characters';
import { fetchSchemeCharacters, getSchemes } from '$lib/api/schemes';
import { masteryForChars, type CharMastery } from '$lib/study/mastery';
import { loadStudyData } from '$lib/study/store';
import { workspaces } from '$lib/workspaces';
import CharactersPage from './+page.svelte';
import charGrid from '$lib/components/map/CharGrid.svelte?raw';
import cellTip from '$lib/components/map/CellTip.svelte?raw';
import stageBar from '$lib/components/map/StageBar.svelte?raw';
import pageSource from './+page.svelte?raw';

const CHARS = [
	{ i: 1, c: '一', t: 1, r: 'yī', m: 'one' },
	{ i: 2, c: '二', t: 1, r: 'èr', m: 'two' },
	{ i: 3, c: '三', t: 1, r: 'sān', m: 'three' },
	{ i: 4, c: '四', t: 1, r: 'sì', m: 'four' },
	{ i: 5, c: '五', t: 1, r: 'wǔ', m: 'five' }
];

const SCORES = [0, 10, 30, 60, 90];

function mastery(): Map<string, CharMastery> {
	return new Map(
		CHARS.map((char, index) => [
			char.c,
			{ score: SCORES[index], stage: 'unknown', reviewedCards: 0 }
		])
	);
}

function select(id: number | null, language = 'zh'): void {
	workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language, name: `w${id}` } as never)
	});
}

beforeEach(() => {
	localStorage.clear();
	select(1);
	vi.mocked(fetchCharacters).mockResolvedValue({ chars: CHARS, count: CHARS.length });
	vi.mocked(getSchemes).mockResolvedValue([
		{ id: 7, name: 'HSK 3.0', unit: 'level', language: 'zh', levels: [] }
	]);
	vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(masteryForChars).mockReturnValue(mastery());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
});

async function ready(): Promise<HTMLElement> {
	const { container } = render(CharactersPage);
	await screen.findByRole('heading', { name: 'Mastery map' });
	await waitFor(() => expect(container.querySelectorAll('.cell').length).toBeGreaterThan(0));
	return container;
}

describe('Stats → Characters', () => {
	it('cells use the st-* mastery class per stage and their accessible name says the stage', async () => {
		const container = await ready();
		const cells = [...container.querySelectorAll<HTMLElement>('.cell')];
		const stages = cells.map((cell) => [...cell.classList].find((name) => name.startsWith('st-')));
		expect(stages).toEqual(['st-unknown', 'st-fresh', 'st-learning', 'st-mature', 'st-learned']);
		expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
			'一, not studied',
			'二, started',
			'三, growing',
			'四, solid',
			'五, learned'
		]);
	});

	it('the legend lists the five stage names with decorative swatches, in order', async () => {
		const container = await ready();
		const legend = screen.getByRole('list', { name: 'Stages' });
		expect([...legend.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
			'Not studied',
			'Started',
			'Growing',
			'Solid',
			'Learned'
		]);
		for (const swatch of legend.querySelectorAll('.swatch')) {
			expect(swatch.getAttribute('aria-hidden')).toBe('true');
		}
		expect(container.querySelectorAll('.stage-legend .swatch')).toHaveLength(5);
	});

	it('Group by is a Select labelled "Group by" with the options and keeps the stored choice', async () => {
		localStorage.setItem('qinqin.map.groupBy.zh', 'strokes');
		await ready();

		const selectEl = screen.getByLabelText('Group by') as HTMLSelectElement;
		expect(selectEl.tagName).toBe('SELECT');
		expect(selectEl.value).toBe('strokes');
		const options = [...selectEl.options].map((option) => option.value);
		expect(options).toContain('common');
		expect(options).toContain('strokes');
		expect(options).toContain('scheme:7');
	});

	it('the Level select filters the map to one level and its own learned count', async () => {
		vi.mocked(getSchemes).mockResolvedValue([
			{
				id: 7,
				name: 'HSK 3.0 (characters)',
				unit: 'character',
				language: 'zh',
				packId: 'hsk-chars',
				levels: [
					{ id: 70, name: 'HSK 1', ord: 0 },
					{ id: 71, name: 'HSK 2', ord: 1 }
				]
			}
		]);
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([
			{ levelId: 70, name: 'HSK 1', chars: new Set(['一', '二']) },
			{ levelId: 71, name: 'HSK 2', chars: new Set(['三']) }
		]);
		const container = await ready();
		const level = screen.getByLabelText('Level') as HTMLSelectElement;
		expect(level.value).toBe('all');
		const group = level.querySelector('optgroup[label="HSK 3.0 (characters)"]')!;
		expect([...group.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['HSK 1', 'HSK 2']);

		await fireEvent.change(level, { target: { value: '7:70' } });
		await waitFor(() => expect(container.querySelectorAll('.cell')).toHaveLength(2));
		expect(container.querySelector('.total strong')?.textContent).toBe('0 of 2 learned (0 %)');
		expect(localStorage.getItem('qinqin.map.level.1')).toBe('7:70');

		await fireEvent.change(level, { target: { value: 'all' } });
		await waitFor(() => expect(container.querySelectorAll('.cell')).toHaveLength(5));
		expect(container.querySelector('.total strong')?.textContent).toBe('1 of 5 learned (20 %)');
	});

	it('reads a remembered level and falls back to all levels for a stale one', async () => {
		vi.mocked(getSchemes).mockResolvedValue([
			{
				id: 7,
				name: 'HSK 3.0 (characters)',
				unit: 'character',
				language: 'zh',
				packId: 'hsk-chars',
				levels: [{ id: 71, name: 'HSK 2', ord: 0 }]
			},
			{
				id: 8,
				name: 'HSK 3.0 (words)',
				unit: 'word',
				language: 'zh',
				packId: 'hsk-words',
				levels: [{ id: 81, name: 'HSK 2', ord: 0 }]
			}
		]);
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([
			{ levelId: 71, name: 'HSK 2', chars: new Set(['三']) }
		]);
		localStorage.setItem('qinqin.map.level.1', '7:71');
		localStorage.setItem('qinqin.map.groupBy.zh', 'scheme:8');
		const container = await ready();
		expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('7:71');
		expect((screen.getByLabelText('Group by') as HTMLSelectElement).value).toBe('scheme:7');
		await waitFor(() => expect(container.querySelectorAll('.cell')).toHaveLength(1));

		localStorage.setItem('qinqin.map.level.1', '7:999');
		cleanup();
		const fresh = await ready();
		expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('all');
		expect(fresh.querySelectorAll('.cell')).toHaveLength(5);
	});

	it('the stage filter is a group of text toggles with aria-pressed, the counts in text', async () => {
		await ready();
		const group = screen.getByRole('group', { name: 'Show stage' });
		const buttons = within(group).getAllByRole('button');
		expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
			'true',
			'false',
			'false',
			'false'
		]);
		expect(buttons[0].textContent).toContain('All');
		expect(buttons[0].textContent).toContain('5');
		expect(buttons[1].textContent).toContain('Not studied');
		expect(buttons[1].textContent).toContain('1');
	});

	it('search and jump are Fields', async () => {
		await ready();
		expect(screen.getByLabelText('Search').tagName).toBe('INPUT');
		expect(screen.getByLabelText('Jump to character').tagName).toBe('INPUT');
		expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
	});

	it('a direct visit outside Han languages keeps the not-Han note and the Overview link', async () => {
		select(1, 'es');
		render(CharactersPage);

		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('The character map is for Chinese and Japanese workspaces.');
		expect(screen.getByRole('link', { name: 'See the Overview' }).getAttribute('href')).toBe('/stats');
		expect(fetchCharacters).not.toHaveBeenCalled();
		expect(loadStudyData).not.toHaveBeenCalled();
	});
});

describe('the mastery map in the single-hue ramp (source checks)', () => {
	const COLOUR_TOKEN = /^--(accent|readable|bad|warn|good|st-|raised|chrome|grade|selected|primary|highlight)/;
	const tokens = (source: string): string[] => [
		...new Set([...source.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
	];

	it.each([
		['CharGrid', charGrid],
		['CellTip', cellTip],
		['StageBar', stageBar]
	])('%s uses only the mastery ramp and neutral tokens for colour', (_name, source) => {
		expect(tokens(source).filter((token) => COLOUR_TOKEN.test(token))).toEqual([]);
	});

	it('the stage-0 cell is an outline, not a fill', () => {
		expect(charGrid).toMatch(/\.st-unknown\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--muted\)/);
		expect(charGrid).toMatch(/\.st-unknown\s*\{[^}]*background:\s*transparent/);
	});

	it('cells are 34px on desktop and 30px on the phone', () => {
		expect(charGrid).toMatch(/--cell-size:\s*34px/);
		expect(charGrid).toMatch(/--cell-size:\s*30px/);
	});

	it('has a forced-colours block with the per-stage border shapes and CanvasText', () => {
		expect(charGrid).toMatch(/@media \(forced-colors: active\)/);
		expect(charGrid).toMatch(/border-style:\s*dotted/);
		expect(charGrid).toMatch(/border-style:\s*dashed/);
		expect(charGrid).toMatch(/border-style:\s*double/);
		expect(charGrid).toMatch(/color:\s*CanvasText/);
	});

	it('type weights stay at or below 600 in the page and its pieces', () => {
		for (const source of [pageSource, charGrid, cellTip, stageBar]) {
			const css = source.slice(source.indexOf('<style>'));
			expect(css).not.toMatch(/font-weight:\s*(bold|[7-9]00|6[1-9]\d)/);
		}
	});
});
