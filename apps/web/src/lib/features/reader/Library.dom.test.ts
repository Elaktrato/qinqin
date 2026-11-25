import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/library', () => ({
	listBooks: vi.fn(),
	listAllBooks: vi.fn(),
	uploadBook: vi.fn(),
	deleteBook: vi.fn()
}));

import { listAllBooks, listBooks } from '$lib/api/library';
import type { Book } from '$lib/api/types';
import { primaryActions } from '$lib/ui/testing/primary';
import Library from './Library.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const book = (id: number): Book => ({
	id,
	workspaceId: 1,
	language: 'zh',
	title: `Book ${id}`,
	author: 'Author',
	source: 'upload',
	sourceId: `u-${id}`,
	sourceUrl: '',
	attribution: '',
	licenseNote: '',
	chapterCount: 3,
	position: '',
	createdAt: '2026-01-01T00:00:00Z'
});

beforeEach(() => {
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'Chinese' } as never],
		current: { id: 1, language: 'zh', name: 'Chinese' } as never
	});
	vi.mocked(listBooks).mockResolvedValue([book(1), book(2)]);
	vi.mocked(listAllBooks).mockResolvedValue([]);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('Library in the lighter look (#106)', () => {
	it('has one primary upload; books are hairline rows with secondary actions', async () => {
		render(Library, { context: ctx.context });
		await screen.findByRole('link', { name: 'Book 1' });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Add an epub' }).className).toContain('primary');
		const row = screen.getByRole('link', { name: 'Book 1' }).closest('li') as HTMLElement;
		expect(row.querySelector('.button.secondary')).toBeTruthy();
		const file = screen.getByLabelText('Epub file (max 20 MB)') as HTMLInputElement;
		expect(file.type).toBe('file');
		expect(file.classList.contains('visually-hidden')).toBe(true);
	});
});
