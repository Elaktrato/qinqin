import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

import VisualAidsSettings from './VisualAidsSettings.svelte';

let ctx: TestContext = testContext();

function open(settings: Record<string, unknown> = {}) {
	const ws: Workspace = { id: 4, language: 'zh', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(VisualAidsSettings, { context: ctx.context });
}

beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Settings > Study > Visual aids (#212)', () => {
	it('has a switch per aid, all on by default', () => {
		open();
		for (const name of ['Pictures', 'Tone colours', 'Character anatomy']) {
			expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(true);
		}
	});

	it('shows the stored choice', () => {
		open({ visualAids: { toneColors: false } });
		expect((screen.getByRole('checkbox', { name: 'Tone colours' }) as HTMLInputElement).checked).toBe(false);
		expect((screen.getByRole('checkbox', { name: 'Pictures' }) as HTMLInputElement).checked).toBe(true);
	});

	it('saves one switch by merge patch', async () => {
		open();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Character anatomy' }));
		await waitFor(() =>
			expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { visualAids: { anatomy: false } })
		);
	});

	it('previews the tone colours and contours even when the switch is off', () => {
		const { container } = open({ visualAids: { toneColors: false } });
		expect(container.querySelectorAll('[data-testid="tone-preview"] .syl')).toHaveLength(5);
		expect(screen.getByTestId('anatomy-preview').textContent).toContain('明');
	});

	it('shows a failed save', async () => {
		vi.spyOn(ctx.session.workspaces, 'setSettings').mockRejectedValue(new Error('offline'));
		open();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Pictures' }));
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
	});
});
