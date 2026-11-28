import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

import ConjugationSettings from './ConjugationSettings.svelte';

let ctx: TestContext = testContext();

function open(settings: Record<string, unknown> = {}, language = 'ja') {
	const ws: Workspace = { id: 4, language, name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(ConjugationSettings, { context: ctx.context });
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Settings > Study > Conjugation (#178)', () => {
	it('has the beginner families on and the later ones off by default', () => {
		open();
		expect(screen.getByRole('heading', { name: 'Conjugation' })).toBeTruthy();
		expect(screen.getAllByRole('checkbox')).toHaveLength(10);
		expect(box('Polite (〜ます, 〜ません, 〜ましょう)').checked).toBe(true);
		expect(box('て-form').checked).toBe(true);
		expect(box('Passive').checked).toBe(false);
	});

	it('shows the stored choice and saves one family by merge patch', async () => {
		open({ conjugation: { families: { passive: true } } });
		expect(box('Passive').checked).toBe(true);
		await fireEvent.click(box('Causative (make, let)'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { conjugation: { families: { causative: true } } }));
		await fireEvent.click(box('て-form'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { conjugation: { families: { 'te-form': false } } }));
	});

	it('a failed save says so', async () => {
		vi.mocked(ctx.session.workspaces.setSettings).mockRejectedValue(new Error('offline'));
		open();
		await fireEvent.click(box('Passive'));
		expect(await screen.findByRole('alert')).toBeTruthy();
	});

	it('is only there in a Japanese workspace', () => {
		open({}, 'zh');
		expect(screen.queryByRole('heading', { name: 'Conjugation' })).toBeNull();
	});
});
