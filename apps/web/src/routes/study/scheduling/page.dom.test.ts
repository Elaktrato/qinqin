import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/features/flashcards/commands/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/flashcards/commands/settings')>()),
	saveParamSet: vi.fn(),
	setActiveSet: vi.fn(),
	deleteParamSet: vi.fn()
}));
vi.mock('$lib/studycore/currentContext', () => ({
	currentContext: vi.fn(() => ({ clock: {} })),
	contextForData: vi.fn(() => ({ clock: {} }))
}));
vi.mock('$lib/features/flashcards/fsrs/dataset', () => ({
	buildDataset: vi.fn(() => ({ cards: [], labelled: 500 }))
}));
vi.mock('$lib/features/flashcards/fsrs/optimizerClient', () => ({
	runOptimizer: vi.fn(),
	runPreview: vi.fn()
}));

import { loadStudyData } from '$lib/studycore/data';
import { runOptimizer, runPreview } from '$lib/features/flashcards/fsrs/optimizerClient';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const ws = { id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' } as never;

beforeEach(() => {
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadStudyData).mockResolvedValue({ cards: [], reviews: [], fsrs: null } as never);
	vi.mocked(runOptimizer).mockResolvedValue({
		ok: true,
		w: [1, 2],
		labelled: 500,
		logLoss: 0.3,
		rmseBins: 0.1,
		heldOut: null
	} as never);
	vi.mocked(runPreview).mockResolvedValue({
		dueNow: [1, 2],
		due7: [3, 4],
		due30: [5, 6],
		medianIntervalDays: [7, 8],
		moved: [],
		surge: false
	} as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('study scheduling, the way back', () => {
	it('links back to the advanced settings, where its link lives', async () => {
		render(Page, { context: ctx.context });
		expect((await screen.findByRole('link', { name: 'Back to advanced settings' })).getAttribute('href')).toBe('/study/advanced');
	});
});

describe('study scheduling in the lighter look (#106)', () => {
	it('shows the panels as Sections and Optimise as the one primary', async () => {
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Optimise' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Saved sets' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Import / export' })).toBeTruthy();
		const optimise = screen.getByRole('button', { name: 'Optimise' });
		expect(primaryActions(document.body)).toEqual([optimise]);
	});

	it('the parameters are a Field underline', async () => {
		render(Page, { context: ctx.context });
		const field = await screen.findByLabelText('Parameters (17, 19 or 21 numbers, as in Anki)');
		expect(field.closest('.field')).not.toBeNull();
	});

	it('a result makes Apply the one primary and Optimise secondary', async () => {
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Optimise' }));
		await screen.findByRole('heading', { name: 'Preview' });
		await waitFor(() => expect(runPreview).toHaveBeenCalled());
		expect(await screen.findByText(/Due now/)).toBeTruthy();
		const apply = screen.getByRole('button', { name: 'Apply' });
		expect(primaryActions(document.body)).toEqual([apply]);
		expect(screen.getByRole('button', { name: 'Optimise' }).className).toContain('secondary');
	});
});
