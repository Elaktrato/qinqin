import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/adminSettings', () => ({
	getAuthSettings: vi.fn(),
	patchAuthSettings: vi.fn(),
	listAudit: vi.fn()
}));

import * as api from '$lib/api/adminSettings';
import SecurityAdmin from './SecurityAdmin.svelte';

const settings = (o: object = {}) => ({
	registration: 'closed', emailPolicy: 'off', mfaEnforced: false, emailCodeLogin: false, mail: { configured: false }, ...o
});
const ev = (id: number) => ({ id, at: '2026-11-15T10:00:00Z', action: 'user_created', actor: { id: 1, name: 'alice' }, target: { id: 2, name: 'bobby' }, detail: {} });

beforeEach(() => {
	vi.mocked(api.getAuthSettings).mockResolvedValue(settings() as never);
	vi.mocked(api.listAudit).mockResolvedValue({ events: [ev(9), ev(8)], next: 8 } as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('SecurityAdmin', () => {
	it('sends the registration choice and announces it', async () => {
		vi.mocked(api.patchAuthSettings).mockResolvedValue(settings({ registration: 'invite' }) as never);
		render(SecurityAdmin);
		await fireEvent.click(await screen.findByRole('radio', { name: /By invite/ }));
		await waitFor(() => expect(api.patchAuthSettings).toHaveBeenCalledWith({ registration: 'invite' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Registration is now by invite'));
	});

	it('hides the MFA and email-code switches behind the needs-email sentence', async () => {
		render(SecurityAdmin);
		await screen.findByRole('radio', { name: /Closed/ });
		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(screen.getByText(/Needs email/)).toBeTruthy();
	});

	it('shows the switches when mail is configured', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue(settings({ mail: { configured: true } }) as never);
		render(SecurityAdmin);
		expect(await screen.findByRole('checkbox', { name: /Require two-factor/ })).toBeTruthy();
	});

	it('pages the audit list with Load older', async () => {
		vi.mocked(api.listAudit).mockResolvedValueOnce({ events: [ev(9), ev(8)], next: 8 } as never);
		vi.mocked(api.listAudit).mockResolvedValueOnce({ events: [ev(7)], next: null } as never);
		render(SecurityAdmin);
		const list = await screen.findByRole('list', { name: 'Recent activity' });
		expect(list.querySelectorAll('li')).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
		await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(3));
		expect(api.listAudit).toHaveBeenLastCalledWith(8);
		expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
	});
});
