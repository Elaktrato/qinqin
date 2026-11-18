import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));
vi.mock('$lib/i18n/reloadPage', () => ({ reloadPage: vi.fn() }));
vi.mock('$lib/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/auth')>()),
	logout: vi.fn()
}));

import { ApiError, api } from '$lib/api/client';
import { auth, logout } from '$lib/auth';
import { primaryActions } from '$lib/ui/testing/primary';
import AccountSettings from './AccountSettings.svelte';
import { reloadPage } from '$lib/i18n/reloadPage';
import { MIRROR_KEY } from '$lib/i18n/interfaceLanguage';

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
let tokens: unknown[] = [];
beforeEach(() => {
	list = sessions();
	tokens = [];
	localStorage.setItem('qinqin.token', 'tok');
	auth.set({ token: 'tok', user: me });
	vi.mocked(api).mockImplementation((async (url: string, opts?: { method?: string }) => {
		if (url === '/api/account/sessions' && !opts?.method) return list;
		if (url === '/api/account/password') return { status: 'ok' };
		if (url === '/api/auth/options') return { emailPolicy: 'off' };
		if (url.startsWith('/api/account/sessions/') && opts?.method === 'DELETE') return undefined;
		if (url === '/api/account/sessions/revoke') return { revoked: 1 };
		if (url === '/api/account/tokens' && !opts?.method) return { accessTokens: tokens };
		if (url === '/api/me/interface-language' && opts?.method === 'PUT') return (opts as { body: unknown }).body;
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
			if (url === '/api/account/tokens') return { accessTokens: [] };
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

describe('Settings → Account: sections in the lighter look (#106)', () => {
	it('has one primary per saving section and underline fields', () => {
		render(AccountSettings);
		const password = screen.getByRole('region', { name: 'Password' });
		expect(primaryActions(password)).toHaveLength(1);
		expect(within(password).getByRole('button', { name: 'Change password' }).className).toContain('primary');
		expect(screen.getByLabelText('Current password').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('New password').closest('.field')).toBeTruthy();
		const language = screen.getByRole('region', { name: 'Language' });
		expect(primaryActions(language)).toHaveLength(1);
		expect(screen.getByLabelText('Interface language').closest('.field')).toBeTruthy();
		const deleteSection = screen.getByRole('region', { name: 'Delete account' });
		const open = within(deleteSection).getByRole('button', { name: 'Delete my account…' });
		expect(open.className).toContain('danger');
		expect(open.className).not.toContain('primary');
	});

	it('renders the session list as a .ui-table', async () => {
		render(AccountSettings);
		const table = await screen.findByRole('table', { name: 'Signed-in devices' });
		expect(table.className).toContain('ui-table');
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

describe('Settings → Account: access tokens and containment', () => {
	const token = {
		id: 1, name: 'cron', hint: 'abcdef', scope: 'read', workspaceId: null,
		createdAt: '2026-11-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', lastUsedAt: null, expired: false
	};

	it('shows the Access tokens section', async () => {
		render(AccountSettings);
		expect(await screen.findByRole('heading', { name: 'Access tokens' })).toBeTruthy();
		await screen.findByText('No access tokens yet.');
	});

	it('says tokens are revoked too, where the user has any', async () => {
		tokens = [token];
		render(AccountSettings);
		await screen.findByRole('table', { name: 'Access tokens' });
		const pw = screen.getByRole('region', { name: 'Password' });
		expect(pw.textContent).toContain('Your access tokens are revoked too.');
		const sess = screen.getByRole('region', { name: 'Sessions' });
		expect(sess.textContent).toContain('Your access tokens are revoked too.');
		await fireEvent.click(screen.getByRole('button', { name: 'Log out everywhere' }));
		const confirm = screen.getByRole('group', { name: 'Confirm log out everywhere' });
		expect(confirm.textContent).toContain('Your access tokens are revoked too.');
	});

	it('says nothing about tokens when there are none', async () => {
		render(AccountSettings);
		await screen.findByText('No access tokens yet.');
		expect(document.body.textContent).not.toContain('Your access tokens are revoked too.');
	});
});

describe('Settings → Account: interface language', () => {
	it('offers the browser default and each supported language by its own name', async () => {
		render(AccountSettings);
		const select = screen.getByLabelText('Interface language') as HTMLSelectElement;
		expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Browser default (English)', 'English']);
		expect(select.value).toBe('');
	});

	it('shows the stored setting', async () => {
		auth.set({ token: 'tok', user: { ...me, interfaceLanguage: 'en' } });
		render(AccountSettings);
		expect((screen.getByLabelText('Interface language') as HTMLSelectElement).value).toBe('en');
	});

	it('saving stores the setting on the server, mirrors it and reloads', async () => {
		render(AccountSettings);
		await fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'en' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/me/interface-language');
		expect(call?.[1]).toMatchObject({ method: 'PUT', body: { language: 'en' } });
		expect(localStorage.getItem(MIRROR_KEY)).toBe('en');
	});

	it('a save that cannot be mirrored (storage blocked) does not reload, which would drop the session', async () => {
		const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		try {
			render(AccountSettings);
			await fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'en' } });
			await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
			expect((await screen.findByText(/This browser blocks site storage/)).textContent).toBeTruthy();
			expect(reloadPage).not.toHaveBeenCalled();
			expect((screen.getByRole('button', { name: 'Save language' }) as HTMLButtonElement).disabled).toBe(false);
		} finally {
			setItem.mockRestore();
		}
	});

	it('a refused save says so and does not reload', async () => {
		vi.mocked(api).mockImplementation((async (url: string, opts?: { method?: string }) => {
			if (url === '/api/me/interface-language') throw new ApiError(422, JSON.stringify({ error: 'invalid_language', message: 'x' }));
			if (url === '/api/account/sessions') return list;
			if (url === '/api/auth/options') return { emailPolicy: 'off' };
			if (url === '/api/account/tokens') return { accessTokens: [] };
			void opts;
			throw new Error(`unexpected ${url}`);
		}) as never);
		render(AccountSettings);
		await fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'en' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save language' }));
		expect((await screen.findByText(/interface language must be empty/)).textContent).toBeTruthy();
		expect(reloadPage).not.toHaveBeenCalled();
	});
});
