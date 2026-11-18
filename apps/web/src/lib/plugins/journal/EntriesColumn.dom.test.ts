import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEntry, Review } from './types';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('./store', () => ({ listEntries: vi.fn(), getReview: vi.fn() }));
vi.mock('./photoDraftStore', () => ({ loadDraft: vi.fn(() => null), clearDraft: vi.fn() }));
vi.mock('./api', () => ({ photoObjectUrl: vi.fn(async () => 'blob:x') }));

import EntriesColumn from './EntriesColumn.svelte';
import { clearJournalEntriesCache } from './journalEntries.svelte';
import { listEntries, getReview } from './store';
import { loadDraft } from './photoDraftStore';

function entry(id: string, date: string, title: string): JournalEntry {
	return { id, date, title, text: '', source: 'typed', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` };
}

const gate = { enabled: true, hint: null, settingsLink: false };

beforeEach(() => {
	clearJournalEntriesCache();
	vi.mocked(listEntries).mockResolvedValue([entry('b', '2026-11-16', '週末'), entry('a', '2026-11-10', 'Dinner')]);
	vi.mocked(getReview).mockImplementation(async (_ws, id) => (id === 'b' ? ({ entryId: 'b' } as Review) : null));
	vi.mocked(loadDraft).mockReturnValue(null);
});
afterEach(cleanup);

function renderColumn(over: Record<string, unknown> = {}) {
	return render(EntriesColumn, {
		workspaceId: 1,
		workspaceName: 'Chinese',
		language: 'zh',
		currentId: null,
		primaryNew: true,
		onideas: vi.fn(),
		...over
	});
}

describe('EntriesColumn (#103)', () => {
	it('links New entry and lists each entry with its date and study lang', async () => {
		renderColumn();
		const link = await screen.findByRole('link', { name: 'New entry' });
		expect(link.getAttribute('href')).toBe('/p/journal/new');
		const title = await screen.findByText('週末');
		expect(title.getAttribute('lang')).toBe('zh-Hans');
		expect(screen.getByText('Mon 16 Nov')).toBeTruthy();
		expect(screen.getByText('Tue 10 Nov')).toBeTruthy();
	});

	it('marks the open entry aria-current page and gives reviewed entries a dot, a word and a tooltip', async () => {
		renderColumn({ currentId: 'a' });
		const open = await screen.findByRole('link', { name: /Dinner/ });
		expect(open.getAttribute('aria-current')).toBe('page');
		const reviewed = await screen.findByText('Reviewed');
		expect(reviewed.classList.contains('visually-hidden')).toBe(true);
		const row = reviewed.closest('a')!;
		expect(row.querySelector('.reviewed-dot')?.getAttribute('title')).toBe('Reviewed');
	});

	it('offers upload, a saved draft and the settings icon button', async () => {
		vi.mocked(loadDraft).mockReturnValue({ photoId: 'p1' } as never);
		renderColumn();
		expect(await screen.findByRole('link', { name: 'Upload photo' })).toBeTruthy();
		expect(await screen.findByRole('link', { name: 'Resume photo draft' })).toBeTruthy();
		const settings = screen.getByRole('link', { name: 'Journal settings' });
		expect(settings.getAttribute('href')).toBe('/p/journal/settings');
	});

	it('shows Retry on a load error and the empty text when there are no entries', async () => {
		vi.mocked(listEntries).mockRejectedValueOnce(new Error('down'));
		renderColumn();
		expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
		vi.mocked(listEntries).mockResolvedValueOnce([]);
		clearJournalEntriesCache();
		cleanup();
		renderColumn();
		expect(await screen.findByText(/No entries yet/)).toBeTruthy();
	});

	it('the Ideas for today button calls onideas', async () => {
		const onideas = vi.fn();
		renderColumn({ onideas });
		const ideas = await screen.findByRole('button', { name: 'Ideas for today' });
		ideas.click();
		expect(onideas).toHaveBeenCalled();
	});
});
