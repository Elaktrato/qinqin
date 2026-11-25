import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

import HintSettings from './HintSettings.svelte';

let ctx: TestContext = testContext();

function workspace(settings: Record<string, unknown>): Workspace {
	return { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
}

function open(settings: Record<string, unknown> = {}) {
	const ws = workspace(settings);
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(HintSettings, { context: ctx.context });
}

beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Settings → Study → Hints (#215)', () => {
	it('shows the defaults: reading is a hint on Recognise, always on Write, not offered on Tones', () => {
		open();
		const recognise = screen.getByLabelText('Reading on Recognise cards') as HTMLSelectElement;
		expect(recognise.value).toBe('hint');
		expect((screen.getByLabelText('Reading on Write cards') as HTMLSelectElement).value).toBe('always');
		expect(screen.queryByLabelText('Reading on Tones cards')).toBeNull();
		expect(screen.getByText('Not offered on this card')).toBeTruthy();
		expect((screen.getByLabelText('Picture on Recall cards') as HTMLSelectElement).value).toBe('hint');
	});

	it('shows the stored choice', () => {
		open({ hints: { reading: { vocab: 'never' } } });
		expect((screen.getByLabelText('Reading on Recognise cards') as HTMLSelectElement).value).toBe('never');
	});

	it('saves one cell as a merge patch', async () => {
		open();
		await fireEvent.change(screen.getByLabelText('Reading on Recall cards'), { target: { value: 'always' } });
		await waitFor(() =>
			expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { hints: { reading: { reverse: 'always' } } })
		);
	});

	it('says pictures are not available yet', () => {
		open();
		expect(screen.getByText(/Pictures are not available yet/)).toBeTruthy();
	});

	it('shows a failed save', async () => {
		vi.spyOn(ctx.session.workspaces, 'setSettings').mockRejectedValue(new Error('offline'));
		open();
		await fireEvent.change(screen.getByLabelText('Reading on Recall cards'), { target: { value: 'never' } });
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
	});
});
