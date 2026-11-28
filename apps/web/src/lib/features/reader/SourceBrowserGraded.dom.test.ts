import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/library', () => ({
	listSources: vi.fn(),
	listBooks: vi.fn(),
	browseSource: vi.fn(),
	searchSource: vi.fn(),
	importFromSource: vi.fn(),
	gradedCatalogue: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { goto } from '$app/navigation';
import { ApiError } from '$lib/api/client';
import { browseSource, gradedCatalogue, importFromSource, listBooks, listSources } from '$lib/api/library';
import type { Book, GradedText, SourceInfo } from '$lib/api/types';
import fixture from '../../../../../../docs/contracts/graded/catalogue.json';
import SourceBrowser from './SourceBrowser.svelte';

const SOURCES: SourceInfo[] = [
	{ id: 'graded', name: 'Graded readers', languages: ['ja', 'zh'] },
	{ id: 'gutenberg', name: 'Project Gutenberg', languages: ['zh', 'ja'] }
];
const ZH = (fixture.answer.texts as GradedText[]).filter((t) => t.language === 'zh');

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'Chinese' } as never],
		current: { id: 1, language: 'zh', name: 'Chinese' } as never
	});
	vi.mocked(listSources).mockResolvedValue(SOURCES);
	vi.mocked(listBooks).mockResolvedValue([]);
	vi.mocked(browseSource).mockResolvedValue([]);
	vi.mocked(gradedCatalogue).mockResolvedValue(ZH);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('the Graded readers tab (#231)', () => {
	it('opens on the graded readers: the catalogue, no search and no browse request', async () => {
		render(SourceBrowser, { context: ctx.context });
		const tab = await screen.findByRole('tab', { name: 'Graded readers' });
		expect(tab.getAttribute('aria-selected')).toBe('true');
		await screen.findByText(ZH[0].title);
		expect(screen.queryByRole('searchbox')).toBeNull();
		expect(browseSource).not.toHaveBeenCalled();
	});

	it('Read adds the text to the workspace library and opens it', async () => {
		vi.mocked(importFromSource).mockResolvedValue({ id: 42, source: 'graded', sourceId: ZH[0].id } as Book);
		render(SourceBrowser, { context: ctx.context });
		const list = await screen.findByTestId('graded-texts');
		await fireEvent.click(within(list).getAllByRole('button', { name: 'Read' })[0]);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/reader/book/42/0'));
		expect(importFromSource).toHaveBeenCalledWith('graded', ZH[0].id, 1);
	});

	it('opens the book that is already in the library when the add answers 409', async () => {
		vi.mocked(importFromSource).mockRejectedValue(new ApiError(409, 'Already there.'));
		render(SourceBrowser, { context: ctx.context });
		const list = await screen.findByTestId('graded-texts');
		vi.mocked(listBooks).mockResolvedValue([{ id: 9, source: 'graded', sourceId: ZH[0].id } as Book]);
		await fireEvent.click(within(list).getAllByRole('button', { name: 'Read' })[0]);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/reader/book/9/0'));
	});

	it('shows Open for a text the library has', async () => {
		vi.mocked(listBooks).mockResolvedValue([{ id: 5, source: 'graded', sourceId: ZH[0].id } as Book]);
		render(SourceBrowser, { context: ctx.context });
		const list = await screen.findByTestId('graded-texts');
		await waitFor(() => expect(within(list).getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/reader/book/5/0'));
	});
});
