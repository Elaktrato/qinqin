import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/characters', () => ({ fetchCharacters: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ fetchSchemeCharacters: vi.fn(), getSchemes: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/studycore/entriesCache', () => ({
	fillMissingWrittenProgressively: vi.fn(async (cards: unknown[]) => ({ cards, unresolvedCards: 0 }))
}));
vi.mock('$lib/studycore/mastery', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/mastery')>()),
	masteryForChars: vi.fn()
}));

import { fetchCharacters } from '$lib/api/characters';
import { fetchSchemeCharacters, getSchemes } from '$lib/api/schemes';
import { masteryForChars, type CharMastery } from '$lib/studycore/mastery';
import { loadStudyData } from '$lib/studycore/data';
import CharactersPage from './+page.svelte';
import charGrid from '$lib/stats/map/CharGrid.svelte?raw';
import cellTip from '$lib/stats/map/CellTip.svelte?raw';
import stageBar from '$lib/stats/map/StageBar.svelte?raw';
import pageSource from './+page.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

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
	ctx.session.workspaces.set({
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
	vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] });
	vi.mocked(masteryForChars).mockReturnValue(mastery());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
});

async function ready(): Promise<HTMLElement> {
	const { container } = render(CharactersPage, { context: ctx.context });
	await screen.findByRole('heading', { name: 'Mastery map' });
	await waitFor(() => expect(container.querySelectorAll('.cell').length).toBeGreaterThan(0));
	return container;
}

const HSK_SCHEMES = [
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
	},
	{ id: 8, name: 'HSK 3.0 (words)', unit: 'word', language: 'zh', packId: 'hsk-words', levels: [{ id: 80, name: 'HSK 1 words', ord: 0 }] }
];
const HSK_MEMBERS = [
	{ levelId: 70, name: 'HSK 1', chars: new Set(['一', '二']) },
	{ levelId: 71, name: 'HSK 2', chars: new Set(['三']) }
];

/** A Chinese workspace with the HSK packs installed and these settings. */
function hsk(settings: Record<string, unknown> = {}, schemes = true): void {
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'w1', settings } as never });
	if (schemes) vi.mocked(getSchemes).mockResolvedValue(HSK_SCHEMES);
	vi.mocked(fetchSchemeCharacters).mockResolvedValue(HSK_MEMBERS);
}

function merge(target: unknown, patch: unknown): unknown {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
	const out: Record<string, unknown> = typeof target === 'object' && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete out[key];
		else out[key] = merge(out[key], value);
	}
	return out;
}

/** setSettings as the server answers it: the patch merged into the workspace (RFC 7396). */
function saving() {
	return vi.spyOn(ctx.session.workspaces, 'setSettings').mockImplementation(async (id, patch) => {
		const current = ctx.session.workspaces.current!;
		const next = { ...current, settings: merge(current.settings ?? {}, patch) } as typeof current;
		ctx.session.workspaces.set({ list: [], current: next });
		return next;
	});
}

const cells = (container: HTMLElement) => [...container.querySelectorAll('.cell')].map((c) => c.textContent?.trim());
const sectionLabels = (container: HTMLElement) => [...container.querySelectorAll('.block-head .label')].map((l) => l.textContent);

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

	it('goes by HSK in a Chinese workspace with nothing outside: map, counts and Grading (#163)', async () => {
		hsk();
		const container = await ready();
		const grading = screen.getByLabelText('Grading') as HTMLSelectElement;
		expect(grading.tagName).toBe('SELECT');
		expect(grading.value).toBe('pack:hsk-chars');
		expect([...grading.options].map((o) => o.value)).toEqual(['common', 'hkgrade', 'strokes', 'pack:hsk-chars', 'pack:hsk-words']);
		await waitFor(() => expect(cells(container)).toEqual(['一', '二', '三']));
		expect(container.querySelector('.total strong')?.textContent).toBe('0 of 3 learned (0 %)');
		const outside = screen.getByRole('checkbox', { name: 'Include characters outside HSK 3.0 (characters)' }) as HTMLInputElement;
		expect(outside.checked).toBe(false);
		expect(sectionLabels(container)).toEqual(['HSK 1', 'HSK 2']);
	});

	it('Include characters outside adds an Outside group and is saved in the workspace settings', async () => {
		hsk();
		const save = saving();
		const container = await ready();
		await waitFor(() => expect(cells(container)).toHaveLength(3));
		await fireEvent.click(screen.getByRole('checkbox', { name: /Include characters outside/ }));
		expect(save).toHaveBeenCalledWith(1, { masteryMap: { includeOutside: true } });
		await waitFor(() => expect(cells(container)).toEqual(['一', '二', '三', '四', '五']));
		expect(sectionLabels(container)).toEqual(['HSK 1', 'HSK 2', 'Outside HSK 3.0 (characters)']);
		expect(container.querySelector('.total strong')?.textContent).toBe('1 of 5 learned (20 %)');
	});

	it('the study levels limit the map; the last one cannot be switched off', async () => {
		hsk();
		const save = saving();
		const container = await ready();
		const levels = screen.getByRole('group', { name: 'Study levels' });
		const one = within(levels).getByRole('checkbox', { name: 'HSK 1' }) as HTMLInputElement;
		const two = within(levels).getByRole('checkbox', { name: 'HSK 2' }) as HTMLInputElement;
		expect([one.checked, two.checked]).toEqual([true, true]);
		await fireEvent.click(one);
		expect(save).toHaveBeenCalledWith(1, { masteryMap: { levels: { 'hsk-chars': [1] } } });
		await waitFor(() => expect(cells(container)).toEqual(['三']));
		expect(two.disabled).toBe(true);
		await fireEvent.click(one);
		expect(save).toHaveBeenLastCalledWith(1, { masteryMap: { levels: { 'hsk-chars': null } } });
		await waitFor(() => expect(cells(container)).toEqual(['一', '二', '三']));
	});

	it('the Level select narrows within the study set and is remembered on this device', async () => {
		hsk({ masteryMap: { levels: { 'hsk-chars': [1] }, includeOutside: true } });
		const container = await ready();
		const level = screen.getByLabelText('Level') as HTMLSelectElement;
		await waitFor(() => expect([...level.options].map((o) => o.textContent)).toEqual(['All study levels', 'HSK 2', 'Outside HSK 3.0 (characters)']));
		expect(cells(container)).toEqual(['三', '四', '五']);
		await fireEvent.change(level, { target: { value: 'outside' } });
		await waitFor(() => expect(cells(container)).toEqual(['四', '五']));
		expect(localStorage.getItem('qinqin.map.level.1')).toBe('outside');
		await fireEvent.change(level, { target: { value: '7:71' } });
		await waitFor(() => expect(cells(container)).toEqual(['三']));
		expect(container.querySelector('.total strong')?.textContent).toBe('0 of 1 learned (0 %)');
	});

	it('reads a remembered level and falls back to all study levels when it left the set', async () => {
		hsk({ masteryMap: { levels: { 'hsk-chars': [1] } } });
		localStorage.setItem('qinqin.map.level.1', '7:70');
		const container = await ready();
		await waitFor(() => expect(cells(container)).toEqual(['三']));
		expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('all');
		cleanup();
		localStorage.setItem('qinqin.map.level.1', '7:71');
		hsk();
		const again = await ready();
		await waitFor(() => expect(cells(again)).toEqual(['三']));
		expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('7:71');
	});

	it('a built-in grading shows every character, without study levels, outside switch or Level', async () => {
		hsk({ masteryMap: { grading: 'strokes', includeOutside: false } });
		const container = await ready();
		await waitFor(() => expect(cells(container)).toHaveLength(5));
		expect((screen.getByLabelText('Grading') as HTMLSelectElement).value).toBe('strokes');
		expect(screen.queryByRole('group', { name: 'Study levels' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /Include characters outside/ })).toBeNull();
		expect(screen.queryByLabelText('Level')).toBeNull();
	});

	it('choosing a grading saves it; an uninstalled one falls back to HSK, no HSK to Common', async () => {
		hsk({ masteryMap: { grading: 'pack:gone' } });
		const save = saving();
		const container = await ready();
		const grading = screen.getByLabelText('Grading') as HTMLSelectElement;
		expect(grading.value).toBe('pack:hsk-chars');
		await fireEvent.change(grading, { target: { value: 'common' } });
		expect(save).toHaveBeenCalledWith(1, { masteryMap: { grading: 'common' } });
		await waitFor(() => expect(cells(container)).toHaveLength(5));
		cleanup();
		vi.mocked(getSchemes).mockResolvedValue([]);
		hsk({ masteryMap: { grading: 'pack:hsk-chars' } }, false);
		await ready();
		expect((screen.getByLabelText('Grading') as HTMLSelectElement).value).toBe('common');
	});

	it('a Japanese workspace goes by JLPT', async () => {
		select(1, 'ja');
		vi.mocked(getSchemes).mockResolvedValue([
			{ id: 9, name: 'Jōyō kanji by school grade', unit: 'character', language: 'ja', packId: 'joyo-grades', levels: [{ id: 90, name: 'Grade 1', ord: 0 }] },
			{ id: 10, name: 'JLPT kanji (approximate)', unit: 'character', language: 'ja', packId: 'jlpt-kanji', levels: [{ id: 100, name: 'N5', ord: 0 }] }
		]);
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([{ levelId: 100, name: 'N5', chars: new Set(['一']) }]);
		const container = await ready();
		const grading = screen.getByLabelText('Grading') as HTMLSelectElement;
		expect(grading.value).toBe('pack:jlpt-kanji');
		expect([...grading.options].map((o) => o.value)).not.toContain('pack:joyo-grades');
		expect(cells(container)).toEqual(['一']);
	});

	it('a failed save says so and puts the choice back', async () => {
		hsk();
		vi.spyOn(ctx.session.workspaces, 'setSettings').mockRejectedValue(new Error('offline'));
		const container = await ready();
		await waitFor(() => expect(cells(container)).toHaveLength(3));
		const outside = screen.getByRole('checkbox', { name: /Include characters outside/ }) as HTMLInputElement;
		await fireEvent.click(outside);
		expect((await screen.findByRole('alert')).textContent).toContain('Could not save the map settings.');
		await waitFor(() => expect(outside.checked).toBe(false));
		expect(cells(container)).toHaveLength(3);
	});

	it('a late level answer never replaces a newer grading', async () => {
		hsk();
		const seven = HSK_MEMBERS;
		const eight = [{ levelId: 80, name: 'HSK 1 words', chars: new Set(['四', '五']) }];
		let releaseSeven!: (levels: typeof seven) => void;
		const firstSeven = new Promise<typeof seven>((resolve) => (releaseSeven = resolve));
		let calls = 0;
		vi.mocked(fetchSchemeCharacters).mockImplementation((_cache, id) => {
			if (id === 8) return Promise.resolve(eight);
			calls += 1;
			return calls === 1 ? firstSeven : Promise.resolve(seven);
		});
		saving();
		const { container } = render(CharactersPage, { context: ctx.context });
		const grading = (await screen.findByLabelText('Grading')) as HTMLSelectElement;
		await fireEvent.change(grading, { target: { value: 'pack:hsk-words' } });
		await waitFor(() => expect(cells(container)).toEqual(['四', '五']));
		releaseSeven(seven);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(cells(container)).toEqual(['四', '五']);
	});

	it('an empty level says so instead of “No characters match”', async () => {
		hsk();
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([
			...HSK_MEMBERS,
			{ levelId: 72, name: 'HSK 7–9', chars: new Set() }
		]);
		vi.mocked(getSchemes).mockResolvedValue([{ ...HSK_SCHEMES[0], levels: [...HSK_SCHEMES[0].levels, { id: 72, name: 'HSK 7–9', ord: 2 }] }]);
		const container = await ready();
		await waitFor(() => expect(cells(container)).toHaveLength(3));
		await fireEvent.change(screen.getByLabelText('Level'), { target: { value: '7:72' } });
		expect(await screen.findByText('This level has no characters yet.')).toBeTruthy();
		expect(screen.queryByText('No characters match.')).toBeNull();
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
		render(CharactersPage, { context: ctx.context });

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
