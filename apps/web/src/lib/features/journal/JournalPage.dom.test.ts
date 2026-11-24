import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEntry } from './types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/journal') } }));
vi.mock('./api', () => ({
	getCapabilities: vi.fn(async () => ({ ai: { available: true, banner: null }, ocr: { available: false, languageReady: false, language: '' } })),
	photoObjectUrl: vi.fn(async () => 'blob:x')
}));
vi.mock('./store', () => ({
	listEntries: vi.fn(),
	getReview: vi.fn(async () => null),
	getSuggestions: vi.fn(async () => null)
}));
vi.mock('./photoDraftStore', () => ({ loadDraft: vi.fn(() => null), clearDraft: vi.fn() }));

import JournalPage from './JournalPage.svelte';

import { listEntries } from './store';
import source from './JournalPage.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const entry: JournalEntry = {
	id: 'a',
	date: '2026-11-16',
	title: '週末',
	text: 'text',
	source: 'typed',
	createdAt: '2026-11-16T10:00:00Z',
	updatedAt: '2026-11-16T10:00:00Z'
};

beforeEach(() => {
	vi.mocked(listEntries).mockResolvedValue([entry]);
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'Chinese' } as never],
		current: { id: 1, language: 'zh', name: 'Chinese' } as never
	});
});
afterEach(cleanup);

describe('JournalPage in three columns (#103)', () => {
	it('the list view shows the entries column, the empty page and the ideas margin', async () => {
		render(JournalPage, { props: { rest: '' }, context: ctx.context });
		expect((await screen.findAllByRole('link', { name: 'New entry' })).length).toBeGreaterThan(0);
		expect(screen.getByText('Pick an entry or start a new one.')).toBeTruthy();
		expect(screen.getByRole('complementary', { name: 'Margin' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Ideas for today' })).toBeTruthy();
		expect(document.querySelector('.journal-grid.list')?.children).toHaveLength(3);
	});

	it('the grid is entries + page + margin at 1000, page + margin from 720 and one column below', () => {
		expect(source).toMatch(/@media \(min-width: 62\.5rem\)[\s\S]*grid-template-columns: 13rem minmax\(0, 1fr\) 16rem/);
		expect(source).toMatch(/@media \(min-width: 45rem\)[\s\S]*grid-template-columns: 13rem minmax\(0, 1fr\)/);
		expect(source).toMatch(/@media \(max-width: 44.99rem\)[\s\S]*\.journal-grid\.list \.empty-page/);
	});
});
