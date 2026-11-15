import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/entries', () => ({
	getEntry: vi.fn(),
	getCharsUnderRadical: vi.fn(),
	getSharedEntry: vi.fn()
}));
vi.mock('$lib/events', () => ({ record: vi.fn() }));
vi.mock('$lib/components/AddToStudy.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/StrokePlayer.svelte', () => ({ default: () => ({}) }));

import { getCharsUnderRadical, getEntry } from '$lib/api/entries';
import { page } from '$lib/testing/appState.svelte';
import Page from './+page.svelte';

function entry(over: Partial<Entry> = {}): Entry {
	return {
		id: 5,
		language: 'zh',
		kind: 'character',
		written: '你',
		readings: [{ type: 'pinyin', value: 'ni3', plain: 'ni', ord: 0 }],
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		...over
	} as Entry;
}

beforeEach(() => {
	(page as unknown as { params: Record<string, string> }).params = { id: '5' };
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('entry page robustness', () => {
	it('still shows the entry when the optional /chars request fails', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry());
		vi.mocked(getCharsUnderRadical).mockRejectedValue(new Error('chars down'));
		render(Page);
		expect(await screen.findByRole('heading', { name: '你' })).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('does not request /chars for a word', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ kind: 'word', written: '你好' }));
		render(Page);
		await screen.findByRole('heading', { name: '你好' });
		expect(getCharsUnderRadical).not.toHaveBeenCalled();
	});

	it('lists characters under a radical with formatted readings', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ id: 5, written: '亻' }));
		vi.mocked(getCharsUnderRadical).mockResolvedValue([
			{ id: 6, language: 'zh', kind: 'character', written: '他', readings: [{ type: 'pinyin', value: 'ta1', plain: 'ta', ord: 0 }] }
		] as never);
		render(Page);
		const link = await screen.findByRole('link', { name: '他' });
		// Same display form as the main readings section (formatReading).
		expect(link.parentElement?.textContent).toContain('Pinyin: ta1');
	});

	it('shows the radical by its written form', async () => {
		vi.mocked(getEntry).mockImplementation((async (id: number) =>
			id === 9 ? entry({ id: 9, written: '亻' }) : entry({ radicalId: 9 })) as never);
		vi.mocked(getCharsUnderRadical).mockResolvedValue([]);
		render(Page);
		expect(await screen.findByRole('link', { name: /亻/ })).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(/Radical entry #9/)).toBeNull());
	});
});
