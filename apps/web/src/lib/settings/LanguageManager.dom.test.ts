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
		vi.mocked(registerLanguage).mockRejectedValue(new ApiError(409, 'zh is built in'));
		render(LanguageManager);
		await screen.findByText('Portuguese');
		const input = screen.getByLabelText('Language code');
		await fireEvent.input(input, { target: { value: 'PT_br' } });
		expect(screen.getByText('Brazilian Portuguese')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
		await waitFor(() => expect(registerLanguage).toHaveBeenCalledWith('pt-br'));
		expect((await screen.findByRole('alert')).textContent).toContain('zh is built in');
	});

	it('disables Add for an invalid code', async () => {
		setup();
		render(LanguageManager);
		await screen.findByText('Portuguese');
		await fireEvent.input(screen.getByLabelText('Language code'), { target: { value: 'x' } });
		expect((screen.getByRole('button', { name: 'Add language' }) as HTMLButtonElement).disabled).toBe(true);
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
