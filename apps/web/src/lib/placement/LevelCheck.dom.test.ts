import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('./knownIndexLoad', () => ({ loadKnownIndex: vi.fn() }));
vi.mock('$lib/features/flashcards/decks/studyStart', () => ({
	loadedSetup: vi.fn(() => Promise.resolve({})),
	levelSessionConfig: vi.fn((_setup: unknown, schemeId: number, levelName: string) => ({ mode: 'levels', schemeId, levelName }))
}));
vi.mock('$lib/study/session', () => ({ saveConfig: vi.fn() }));

import { goto } from '$app/navigation';
import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { knownIndex } from '$lib/study/known';
import { saveConfig } from '$lib/study/session';
import { loadKnownIndex } from './knownIndexLoad';
import LevelCheck from './LevelCheck.svelte';

const word = (id: number) => ({ id, language: 'zh', kind: 'word', written: `字${id}`, readings: [], attrs: {}, radicalId: null });
const LEVELS: Record<string, number[]> = { 'HSK 1': [1, 2, 3, 4], 'HSK 2': [5, 6], 'HSK 3': [7, 8] };

let ctx: TestContext;
beforeEach(() => {
	vi.clearAllMocks();
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(getSchemes).mockResolvedValue([
		{
			id: 9,
			name: 'HSK',
			unit: 'word',
			language: 'zh',
			packId: 'hsk-words',
			levels: [
				{ id: 1, ord: 1, name: 'HSK 1' },
				{ id: 2, ord: 2, name: 'HSK 2' },
				{ id: 3, ord: 3, name: 'HSK 3' }
			]
		}
	]);
	vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) => (LEVELS[level ?? ''] ?? []).map(word));
	// Entry 1 is marked known; the rest of HSK 1 is unseen.
	vi.mocked(loadKnownIndex).mockResolvedValue(knownIndex([], () => null, [1]));
});
afterEach(() => cleanup());

async function begin(): Promise<void> {
	render(LevelCheck, { context: ctx.context });
	await fireEvent.click(await screen.findByTestId('level-check-start'));
}

describe('LevelCheck', () => {
	it('is marked experimental and says what it does not measure before anything starts', async () => {
		render(LevelCheck, { context: ctx.context });
		await screen.findByTestId('level-check-start');
		expect(screen.getByText('Experimental')).toBeTruthy();
		const limits = screen.getByTestId('level-check-limits').textContent ?? '';
		expect(limits).toMatch(/not the official exam/);
		expect(limits).toMatch(/listening, grammar or reading/);
	});

	it('asks only what the app does not know, then shows coverage, the estimate and the next step', async () => {
		await begin();
		// HSK 1 has 4 entries, 1 known: three questions.
		for (let i = 1; i <= 3; i++) {
			await screen.findByText(`Question ${i} of 3`);
			await fireEvent.click(screen.getByTestId(i === 1 ? 'placement-know' : 'placement-unsure'));
		}
		await screen.findByTestId('level-check-result');
		expect(screen.getByTestId('level-check-estimate').textContent).toMatch(/about \d+%.*HSK 1/);
		const coverage = screen.getByTestId('level-check-coverage').textContent ?? '';
		expect(coverage).toMatch(/1 entry known/);
		expect(coverage).toMatch(/3 entries not started/);
		expect(screen.getAllByText(/not the official exam/).length).toBeGreaterThan(0);
		expect(saveConfig).not.toHaveBeenCalled();
	});

	it('starts a level session for the lowest level that is not covered', async () => {
		await begin();
		for (let i = 0; i < 3; i++) {
			await screen.findByTestId('placement-unsure');
			await fireEvent.click(screen.getByTestId('placement-unsure'));
		}
		await fireEvent.click(await screen.findByTestId('level-check-study'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		expect(saveConfig).toHaveBeenCalledWith({ mode: 'levels', schemeId: 9, levelName: 'HSK 1' });
	});

	it('goes straight to the result when there is nothing to ask', async () => {
		vi.mocked(loadKnownIndex).mockResolvedValue(knownIndex([], () => null, [1, 2, 3, 4]));
		await begin();
		await screen.findByTestId('level-check-result');
		expect(screen.queryByTestId('placement-know')).toBeNull();
		expect(screen.getByText(/Every level up to this one looks covered/)).toBeTruthy();
	});

	it('stops without a result when the learner stops the check', async () => {
		await begin();
		await fireEvent.click(await screen.findByRole('button', { name: 'Stop the check' }));
		await screen.findByTestId('level-check-start');
		expect(screen.queryByTestId('level-check-result')).toBeNull();
	});
});
