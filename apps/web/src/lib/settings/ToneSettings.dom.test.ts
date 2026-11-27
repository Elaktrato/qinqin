import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

import ToneSettings from './ToneSettings.svelte';

let ctx: TestContext = testContext();

function open(settings: Record<string, unknown> = {}, language = 'zh') {
	const ws: Workspace = { id: 4, language, name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(ToneSettings, { context: ctx.context });
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

describe('Settings > Study > Tones (#300)', () => {
	it('Show tone sandhi is on and Grade spoken tones off by default', () => {
		open();
		expect(screen.getByRole('heading', { name: 'Tones' })).toBeTruthy();
		expect(box('Show tone sandhi').checked).toBe(true);
		expect(box('Grade spoken tones').checked).toBe(false);
	});

	it('shows the stored choice', () => {
		open({ tones: { showSandhi: false, gradeSpoken: true } });
		expect(box('Show tone sandhi').checked).toBe(false);
		expect(box('Grade spoken tones').checked).toBe(true);
	});

	it('saves one switch by merge patch', async () => {
		open();
		await fireEvent.click(box('Grade spoken tones'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { tones: { gradeSpoken: true } }));
		await fireEvent.click(box('Show tone sandhi'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { tones: { showSandhi: false } }));
	});

	it('a failed save says so', async () => {
		vi.mocked(ctx.session.workspaces.setSettings).mockRejectedValue(new Error('offline'));
		open();
		await fireEvent.click(box('Grade spoken tones'));
		expect(await screen.findByRole('alert')).toBeTruthy();
	});

	it('is only there for a language with tones', () => {
		open({}, 'ja');
		expect(screen.queryByRole('heading', { name: 'Tones' })).toBeNull();
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	it('its notes print no pinyin (hidden romanisation)', () => {
		const { container } = open({ romanisation: { pinyin: 'never' } });
		expect(container.textContent).not.toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔù]/);
	});
});
