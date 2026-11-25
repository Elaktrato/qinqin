import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

vi.mock('$lib/api/starter', () => ({ starterSets: vi.fn(), starterSet: vi.fn() }));

import { starterSets } from '$lib/api/starter';
import StarterSettings from './StarterSettings.svelte';

let ctx: TestContext = testContext();

function open(language: string, settings: Record<string, unknown> = {}) {
	const ws: Workspace = { id: 4, language, name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(StarterSettings, { context: ctx.context });
}

beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
	vi.mocked(starterSets).mockResolvedValue([
		{ id: 'starter-ja', language: 'ja', name: 'Starter words (Japanese)', license: 'CC0-1.0', attribution: 'x', wordCount: 55, humanReviewed: false }
	]);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Settings → Study → Starter mode (#214)', () => {
	it('is off by default and covers the Starter words only', () => {
		open('ja');
		expect((screen.getByTestId('starter-enabled') as HTMLInputElement).checked).toBe(false);
		expect((screen.getByLabelText('Applies to') as HTMLSelectElement).value).toBe('base');
		expect((screen.getByLabelText('Applies to') as HTMLSelectElement).disabled).toBe(true);
	});

	it('shows the stored choice', () => {
		open('ja', { starter: { enabled: true, scope: 'all' } });
		expect((screen.getByTestId('starter-enabled') as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText('Applies to') as HTMLSelectElement).value).toBe('all');
	});

	it('saves the switch as a merge patch', async () => {
		open('ja');
		await fireEvent.click(screen.getByTestId('starter-enabled'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { starter: { enabled: true } }));
	});

	it('saves the scope', async () => {
		open('ja', { starter: { enabled: true } });
		await fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'all' } });
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { starter: { scope: 'all' } }));
	});

	it('offers the Starter words to add when the language has a set', async () => {
		open('ja');
		expect(await screen.findByRole('button', { name: 'Add the Starter words to my decks' })).toBeTruthy();
	});

	it('says so for a language without stages and offers no switch', () => {
		open('es');
		expect(screen.getByText('Starter mode is available for Japanese and Chinese so far.')).toBeTruthy();
		expect(screen.queryByTestId('starter-enabled')).toBeNull();
	});

	it('shows a failed save', async () => {
		vi.mocked(ctx.session.workspaces.setSettings).mockRejectedValue(new Error('nope'));
		open('ja');
		await fireEvent.click(screen.getByTestId('starter-enabled'));
		expect(await screen.findByRole('alert')).toBeTruthy();
	});
});
