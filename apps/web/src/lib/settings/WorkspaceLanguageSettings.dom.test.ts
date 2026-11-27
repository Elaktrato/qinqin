import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Settings → Workspaces → Interface language (#297). A fake second catalogue `de` is mocked in: the choices are the
// catalogues that exist, so de.json (#144) becomes a choice by being added.
vi.mock('$lib/i18n/negotiate', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n/negotiate')>()),
	SUPPORTED_LANGUAGES: ['en', 'de']
}));

import type { Workspace } from '$lib/api/types';
import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import WorkspaceLanguageSettings from './WorkspaceLanguageSettings.svelte';

let ctx: TestContext = testContext();

function open(settings: Record<string, unknown> = {}, account = '') {
	ctx = testContext({ user: { interfaceLanguage: account } });
	const ws: Workspace = { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockImplementation(async (id, patch) => ({ ...ws, id, settings: { ...settings, ...patch } }));
	return render(WorkspaceLanguageSettings, { props: { label: 'Japanese' }, context: ctx.context });
}

const select = () => screen.getByLabelText('Interface language in this workspace') as HTMLSelectElement;

beforeEach(() => localStorage.clear());
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('Settings → Workspaces → Interface language (#297)', () => {
	it('offers the account setting (named) and every catalogue by its own name', () => {
		open();
		expect([...select().options].map((o) => o.textContent?.trim())).toEqual(['Use my account setting (English)', 'English', 'Deutsch']);
		expect(select().value).toBe('');
		expect(screen.getByText(/while you work in Japanese/)).toBeTruthy();
	});

	it('names the account setting\'s language', () => {
		open({}, 'de');
		expect(select().options[0].textContent?.trim()).toBe('Use my account setting (Deutsch)');
	});

	it('shows the stored setting', () => {
		open({ interfaceLanguage: 'de' });
		expect(select().value).toBe('de');
	});

	it('saves the language by merge patch', async () => {
		open();
		await fireEvent.change(select(), { target: { value: 'de' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { interfaceLanguage: 'de' }));
		await waitFor(() => expect(localStorage.getItem('qq.interfaceLanguage.workspace.4')).toBe('de'));
		expect(screen.queryByText(/This browser blocks site storage/)).toBeNull();
	});

	it('"Use my account setting" clears the key', async () => {
		open({ interfaceLanguage: 'de' });
		await fireEvent.change(select(), { target: { value: '' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { interfaceLanguage: null }));
	});

	it('a save the next start would not show (storage blocked) says so', async () => {
		const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		open();
		await fireEvent.change(select(), { target: { value: 'de' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		expect((await screen.findByText(/This browser blocks site storage/)).textContent).toBeTruthy();
		setItem.mockRestore();
	});

	it('a failed save says so', async () => {
		open();
		vi.mocked(ctx.session.workspaces.setSettings).mockRejectedValue(new Error('down'));
		await fireEvent.change(select(), { target: { value: 'de' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		expect(await screen.findByRole('alert')).toBeTruthy();
	});
});
