import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));
vi.mock('$lib/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/auth')>()),
	logout: vi.fn()
}));

import { ApiError, api } from '$lib/api/client';
import { auth, logout } from '$lib/auth';
import AccountSettings from './AccountSettings.svelte';

const me = {
	id: 1,
	username: 'alice',
	admin: false,
	email: null,
	emailVerified: false,
	mustChangePassword: false,
	createdAt: 't'
};
const sessions = () => ({
	sessions: [
		{ id: 5, device: 'Firefox on Linux', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: '2026-11-15T11:59:50Z', current: true },
		{ id: 3, device: 'Safari on iOS', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-11-14T12:00:00Z', current: false }
	]
});

let list = sessions();
beforeEach(() => {
	list = sessions();
	localStorage.setItem('qinqin.token', 'tok');
	auth.set({ token: 'tok', user: me });
	vi.mocked(api).mockImplementation((async (url: string, opts?: { method?: string }) => {
		if (url === '/api/account/sessions' && !opts?.method) return list;
		if (url === '/api/account/password') return { status: 'ok' };
		if (url.startsWith('/api/account/sessions/') && opts?.method === 'DELETE') return undefined;
		if (url === '/api/account/sessions/revoke') return { revoked: 1 };
		throw new Error(`unexpected ${url}`);
	}) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function fillPassword(current: string, next: string, confirm: string) {
	await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: current } });
	await fireEvent.input(screen.getByLabelText('New password'), { target: { value: next } });
	await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: confirm } });
}

describe('Settings → Account: password', () => {
	it('signs out other sessions by default', async () => {
		render(AccountSettings);
		expect((screen.getByLabelText('Sign out my other sessions') as HTMLInputElement).checked).toBe(true);
		await fillPassword('secret-pass-alice', 'a-new-long-password', 'a-new-long-password');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Password changed'));
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/password');
		expect(call?.[1]).toMatchObject({
			method: 'POST',
			body: { currentPassword: 'secret-pass-alice', newPassword: 'a-new-long-password', signOutOthers: true }
		});
	});

	it('can keep the other sessions', async () => {
		render(AccountSettings);
		await fireEvent.click(screen.getByLabelText('Sign out my other sessions'));
		await fillPassword('secret-pass-alice', 'a-new-long-password', 'a-new-long-password');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		await waitFor(() => screen.getByRole('status'));
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/password');
		expect(call?.[1]).toMatchObject({ body: { signOutOthers: false } });
	});

	it('shows "The current password is wrong." for 403 wrong_password and stays signed in', async () => {
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/account/sessions') return list;
			throw new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' }));
		}) as never);
		render(AccountSettings);
		await fillPassword('nope', 'a-new-long-password', 'a-new-long-password');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The current password is wrong.');
		expect(get(auth).token).toBe('tok');
		expect(logout).not.toHaveBeenCalled();
	});

	it('checks the new password locally and sends nothing', async () => {
		render(AccountSettings);
		await fillPassword('secret-pass-alice', 'short', 'short');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Use at least 10 characters.');
		expect(vi.mocked(api).mock.calls.some(([u]) => u === '/api/account/password')).toBe(false);
	});
});

describe('Settings → Account: sessions', () => {
	it('lists sessions in an accessible table and hides revoke on this device', async () => {
		render(AccountSettings);
		const table = await screen.findByRole('table', { name: 'Signed-in devices' });
		for (const h of ['Device', 'Signed in', 'Last active']) {
			expect(within(table).getByRole('columnheader', { name: h }).getAttribute('scope')).toBe('col');
		}
		const rows = within(table).getAllByRole('row').slice(1);
		expect(within(rows[0]).getByText('This device')).toBeTruthy();
		expect(within(rows[0]).queryByRole('button')).toBeNull();
		expect(within(rows[1]).getByRole('button', { name: 'Revoke Safari on iOS' })).toBeTruthy();
	});

	it('revoking a row removes it', async () => {
		render(AccountSettings);
		await fireEvent.click(await screen.findByRole('button', { name: 'Revoke Safari on iOS' }));
		await waitFor(() => expect(screen.queryByText('Safari on iOS')).toBeNull());
		const del = vi.mocked(api).mock.calls.find(([u, o]) => u === '/api/account/sessions/3' && (o as { method?: string })?.method === 'DELETE');
		expect(del).toBeTruthy();
	});

	it('"Log out everywhere else" asks the server for the others', async () => {
		render(AccountSettings);
		await fireEvent.click(await screen.findByRole('button', { name: 'Log out everywhere else' }));
		await waitFor(() => {
			const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/sessions/revoke');
			expect(call?.[1]).toMatchObject({ method: 'POST', body: { scope: 'others' } });
		});
	});

	it('"Log out everywhere" confirms first, then signs this device out too', async () => {
		render(AccountSettings);
		await fireEvent.click(await screen.findByRole('button', { name: 'Log out everywhere' }));
		expect(screen.getByText('Log out everywhere? Every device, including this one, will need to sign in again.')).toBeTruthy();
		expect(vi.mocked(api).mock.calls.some(([u]) => u === '/api/account/sessions/revoke')).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: 'Yes, log out everywhere' }));
		await waitFor(() => expect(logout).toHaveBeenCalled());
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/sessions/revoke');
		expect(call?.[1]).toMatchObject({ body: { scope: 'all' } });
	});

	it('can back out of logging out everywhere', async () => {
		render(AccountSettings);
		await fireEvent.click(await screen.findByRole('button', { name: 'Log out everywhere' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByText(/will need to sign in again/)).toBeNull();
		expect(logout).not.toHaveBeenCalled();
	});
});
