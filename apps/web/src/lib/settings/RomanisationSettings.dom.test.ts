import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

import RomanisationSettings from './RomanisationSettings.svelte';

let ctx: TestContext = testContext();

function open(language: string, settings: Record<string, unknown> = {}) {
	const ws: Workspace = { id: 4, language, name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(RomanisationSettings, { context: ctx.context });
}

const radio = (group: string, name: string) =>
	screen.getByRole('group', { name: group }).querySelector<HTMLInputElement>(`input[value="${name}"]`)!;

beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Settings > Study > Romanisation (#284)', () => {
	it('Chinese: pinyin and bopomofo, each Always by default', () => {
		open('zh');
		expect(radio('Show pinyin', 'always').checked).toBe(true);
		expect(radio('Show bopomofo (zhuyin)', 'always').checked).toBe(true);
		expect(screen.queryByRole('group', { name: 'Show romaji' })).toBeNull();
	});

	it('Japanese: romaji only', () => {
		open('ja', { romanisation: { romaji: 'never' } });
		expect(radio('Show romaji', 'never').checked).toBe(true);
		expect(screen.queryByRole('group', { name: 'Show pinyin' })).toBeNull();
	});

	it('a language without romanisation shows nothing', () => {
		const { container } = open('es');
		expect(container.textContent?.trim()).toBe('');
	});

	it('saves one type at a time by merge patch', async () => {
		open('zh', { romanisation: { bopomofo: 'never' } });
		await fireEvent.click(radio('Show pinyin', 'never'));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { romanisation: { pinyin: 'never' } }));
	});

	it('shows a failed save', async () => {
		vi.mocked(ctx.session.workspaces.setSettings).mockRejectedValue(new Error('down'));
		open('ja');
		await fireEvent.click(radio('Show romaji', 'never'));
		expect(await screen.findByRole('alert')).toBeTruthy();
	});
});
