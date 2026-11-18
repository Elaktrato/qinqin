import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/library', () => ({
	listSources: vi.fn(),
	listBooks: vi.fn(),
	browseSource: vi.fn(),
	searchSource: vi.fn(),
	importFromSource: vi.fn()
}));

import { browseSource, listBooks, listSources } from '$lib/api/library';
import type { SourceInfo, SourceResult } from '$lib/api/types';
import { primaryActions } from '$lib/ui/testing/primary';
import { workspaces } from '$lib/workspaces';
import SourceBrowser from './SourceBrowser.svelte';

const SOURCE: SourceInfo = {
	id: 'gutenberg',
	name: 'Project Gutenberg',
	languages: ['zh', 'en'],
	license: 'Public domain',
	attribution: 'Project Gutenberg'
} as SourceInfo;

const RESULT: SourceResult = {
	sourceId: 'g-1',
	title: '故乡',
	author: 'Lu Xun',
	language: 'zh',
	note: '',
	reading: ''
} as SourceResult;

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'Chinese' } as never],
		current: { id: 1, language: 'zh', name: 'Chinese' } as never
	});
	vi.mocked(listSources).mockResolvedValue([SOURCE]);
	vi.mocked(listBooks).mockResolvedValue([]);
	vi.mocked(browseSource).mockResolvedValue([RESULT]);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('SourceBrowser in the lighter look (#106)', () => {
	it('uses base tabs and a Field search, hairline result rows and no primary', async () => {
		render(SourceBrowser);
		expect(await screen.findByRole('tab', { name: 'Project Gutenberg' })).toBeTruthy();
		await screen.findByText('故乡');
		expect(primaryActions(document.body)).toHaveLength(0);
		expect(screen.getByRole('searchbox').closest('.field')).toBeTruthy();
		const row = screen.getByText('故乡').closest('li') as HTMLElement;
		expect(row.querySelector('.button.secondary')).toBeTruthy();
	});
});
