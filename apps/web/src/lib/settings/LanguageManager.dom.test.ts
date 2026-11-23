import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/languages', () => ({ listLanguages: vi.fn() }));
vi.mock('$lib/api/packs', () => ({ listPacks: vi.fn() }));
vi.mock('$lib/api/adminLanguages', () => ({
	languageUsage: vi.fn(),
	registerLanguage: vi.fn(),
	removeLanguage: vi.fn()
}));

import { ApiError } from '$lib/api/client';
import { languageUsage, registerLanguage, removeLanguage } from '$lib/api/adminLanguages';
import { listLanguages } from '$lib/api/languages';
import { listPacks } from '$lib/api/packs';
import LanguageManager from './LanguageManager.svelte';

function setup() {
	vi.mocked(listLanguages).mockResolvedValue([
		{ code: 'zh', name: 'zh', installed: true, kind: 'code' },
		{ code: 'pt', name: 'pt', installed: false, kind: 'data' }
	]);
	vi.mocked(listPacks).mockResolvedValue([]);
	vi.mocked(languageUsage).mockResolvedValue([]);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('LanguageManager', () => {
	it('lists languages and removes an unused data-only one after confirming', async () => {
		setup();
		vi.mocked(removeLanguage).mockResolvedValue();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		expect(screen.getByText('built-in')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove Portuguese (pt)' }));
		await fireEvent.click(screen.getByRole('button', { name: /Confirm remove/ }));
		await waitFor(() => expect(removeLanguage).toHaveBeenCalledWith('pt'));
	});

	it('previews the label, registers the normalized code and shows server errors', async () => {
		setup();
		vi.mocked(registerLanguage).mockRejectedValue(
			new ApiError(409, JSON.stringify({ error: 'language_built_in', message: 'zh is built in.' }))
		);
		render(LanguageManager);
		await screen.findByText('Portuguese');
		const input = screen.getByLabelText('Language code');
		await fireEvent.input(input, { target: { value: 'PT_br' } });
		expect(screen.getByText('Brazilian Portuguese')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
		await waitFor(() => expect(registerLanguage).toHaveBeenCalledWith('pt-br'));
		expect((await screen.findByRole('alert')).textContent).toContain('This language is built in');
	});

	it('disables Add for an invalid code', async () => {
		setup();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		await fireEvent.input(screen.getByLabelText('Language code'), { target: { value: 'x' } });
		expect((screen.getByRole('button', { name: 'Add language' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('a submitted invalid code says what a code looks like (catalogue text, English unchanged)', async () => {
		setup();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		const input = screen.getByLabelText('Language code');
		await fireEvent.input(input, { target: { value: 'x' } });
		await fireEvent.submit(input.closest('form')!);
		expect((await screen.findByRole('alert')).textContent?.trim()).toBe('language must be a code like es or pt-br');
		expect(registerLanguage).not.toHaveBeenCalled();
	});

	it('a language still in use says so by code and lists the counts the server sent', async () => {
		setup();
		vi.mocked(removeLanguage).mockRejectedValue(
			new ApiError(
				409,
				JSON.stringify({ error: 'language_in_use', message: 'The language is still used by: 2 workspaces.', usage: { workspaces: 2, sentencePacks: 1 } })
			)
		);
		render(LanguageManager);
		await screen.findByText('Portuguese');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove Portuguese (pt)' }));
		await fireEvent.click(screen.getByRole('button', { name: /Confirm remove/ }));
		expect((await screen.findByRole('alert')).textContent).toBe('Workspaces or installed packs still use this language.');
		const items = [...document.querySelectorAll('.in-use li')].map((li) => li.textContent);
		expect(items).toEqual(['2 workspaces', '1 installed pack']);
		expect(document.body.textContent).not.toContain('still used by');
	});

	it('moves focus to Confirm after Remove and back to Remove on Cancel', async () => {
		setup();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove Portuguese (pt)' }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Confirm remove/ })));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Portuguese (pt)' })));
	});

	it('labels the actions column for screen readers', async () => {
		setup();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
	});
});
