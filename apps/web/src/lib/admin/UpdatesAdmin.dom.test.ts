import { testContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '$lib/api/adminUpdate';

vi.mock('$lib/api/adminUpdate', () => ({ getUpdateStatus: vi.fn(), patchUpdateSettings: vi.fn(), checkUpdateNow: vi.fn() }));
import * as api from '$lib/api/adminUpdate';
import UpdatesAdmin from './UpdatesAdmin.svelte';

const base: UpdateStatus = {
	installed: { version: '0.6.0', commit: 'abc1234def5678', buildDate: '2026-11-01T00:00:00Z' },
	settings: { enabled: true, prereleases: false },
	check: {
		state: 'ok',
		stale: false,
		latest: { version: '0.7.0', tag: 'v0.7.0', name: 'qinqin v0.7.0', url: 'https://github.com/Elaktrato/qinqin/releases/tag/v0.7.0', publishedAt: '2026-11-20T10:00:00Z', prerelease: false, notes: 'Fixes <b>things</b>' },
		update: 'available',
		checkedAt: '2026-11-25T12:00:00Z'
	}
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('UpdatesAdmin', () => {
	it('shows installed against latest, notes as plain text and the release link', async () => {
		vi.mocked(api.getUpdateStatus).mockResolvedValue(base);
		render(UpdatesAdmin, { context: testContext().context });
		expect(await screen.findByText('Version 0.7.0 is available.')).toBeTruthy();
		expect(screen.getByText('0.6.0')).toBeTruthy();
		expect(screen.getByText('abc1234def56')).toBeTruthy();
		expect(screen.getByText('Fixes <b>things</b>').tagName).toBe('PRE');
		expect(screen.getByRole('link', { name: /View the release/ }).getAttribute('href')).toBe(base.check.latest!.url);
	});

	it('shows the offline state beside the last known release', async () => {
		vi.mocked(api.getUpdateStatus).mockResolvedValue({ ...base, check: { ...base.check, state: 'error', error: 'offline', stale: true } });
		render(UpdatesAdmin, { context: testContext().context });
		expect(await screen.findByText(/Could not reach GitHub.*Showing the last known release/)).toBeTruthy();
		expect(screen.getByText('Version 0.7.0 is available.')).toBeTruthy();
	});

	it('check now asks the server and shows the answer', async () => {
		vi.mocked(api.getUpdateStatus).mockResolvedValue({ ...base, check: { ...base.check, update: 'current' } });
		vi.mocked(api.checkUpdateNow).mockResolvedValue(base);
		render(UpdatesAdmin, { context: testContext().context });
		await screen.findByText('You are up to date.');
		await fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
		expect(await screen.findByText('Version 0.7.0 is available.')).toBeTruthy();
		expect(api.checkUpdateNow).toHaveBeenCalledTimes(1);
	});

	it('the switch turns the check off and disables Check now', async () => {
		vi.mocked(api.getUpdateStatus).mockResolvedValue(base);
		vi.mocked(api.patchUpdateSettings).mockResolvedValue({ ...base, settings: { enabled: false, prereleases: false }, check: { ...base.check, state: 'disabled', latest: null, update: 'unknown' } });
		render(UpdatesAdmin, { context: testContext().context });
		await screen.findByText('Version 0.7.0 is available.');
		await fireEvent.click(screen.getByLabelText(/Check for new releases/));
		expect(await screen.findByText(/The update check is off/)).toBeTruthy();
		expect(api.patchUpdateSettings).toHaveBeenCalledWith({ enabled: false });
		await waitFor(() => expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(true));
	});

	it('shows a load failure', async () => {
		vi.mocked(api.getUpdateStatus).mockRejectedValue(new Error('x'));
		render(UpdatesAdmin, { context: testContext().context });
		expect((await screen.findByRole('alert')).textContent).toBeTruthy();
	});
});
