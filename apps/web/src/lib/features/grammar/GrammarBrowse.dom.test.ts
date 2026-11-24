import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('./api', () => ({ listGrammar: vi.fn(async () => []) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []) }));
vi.mock('./progress', () => ({ loadProgress: vi.fn(async () => new Map()) }));
vi.mock('./browse', () => ({ browseSections: vi.fn() }));

import { browseSections } from './browse';
import { primaryActions } from '$lib/ui/testing/primary';
import GrammarBrowse from './GrammarBrowse.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const ws = { id: 1, language: 'ja', name: '', settings: {}, updatedAt: '' } as never;

beforeEach(() => {
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(browseSections).mockReturnValue([
		{
			packId: 'basics',
			packName: 'Basic grammar',
			credits: { license: 'CC BY-SA 4.0', attribution: 'Someone' },
			levels: [
				{
					id: 'n5',
					name: 'N5',
					badges: ['HSK 2'],
					lessons: [
						{
							id: 'l1',
							title: 'The は particle',
							summary: 'Topic marker',
							progress: { best: 8, total: 10 }
						}
					]
				}
			]
		}
	] as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('grammar browse in the lighter look (#106)', () => {
	it('packs are Sections, levels carry Chips, points are rows, and there is no primary action', async () => {
		render(GrammarBrowse, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Basic grammar' })).toBeTruthy();
		expect(screen.getByText('HSK 2')).toBeTruthy();
		expect(screen.getByRole('link', { name: /The は particle/ })).toBeTruthy();
		expect(screen.getByText('8/10')).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(0);
	});
});
