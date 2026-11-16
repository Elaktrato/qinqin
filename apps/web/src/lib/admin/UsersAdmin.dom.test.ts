import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/adminUsers', () => ({
	listUsers: vi.fn(),
	createUser: vi.fn(),
	patchUser: vi.fn(),
	revokeUserSessions: vi.fn(),
	issueResetLink: vi.fn(),
	revokeResetLink: vi.fn(),
	deletionPreview: vi.fn(),
	deleteUser: vi.fn(),
	resetUserMfa: vi.fn()
}));
vi.mock('$lib/api/account', () => ({ getAuthOptions: vi.fn() }));

import * as adminUsers from '$lib/api/adminUsers';
import { getAuthOptions } from '$lib/api/account';
import { auth } from '$lib/auth';
import UsersAdmin from './UsersAdmin.svelte';

const dto = (id: number, o: object = {}) => ({
	id,
	username: `user${id}`,
	email: null,
	emailVerified: false,
	admin: false,
	disabled: false,
	mustChangePassword: false,
	createdAt: 't',
	lastSeenAt: null,
	...o
});

beforeEach(() => {
	auth.set({
		token: 't',
		user: { id: 1, username: 'user1', admin: true, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' }
	});
	vi.mocked(adminUsers.listUsers).mockResolvedValue([dto(1, { admin: true }), dto(2)] as never);
	vi.mocked(getAuthOptions).mockResolvedValue({ emailPolicy: 'off' } as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('UsersAdmin', () => {
	it('revokes a pending reset link without asking for a password', async () => {
		vi.mocked(adminUsers.revokeResetLink).mockResolvedValue(undefined as never);
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		const row = screen.getByRole('row', { name: /user2/ });
		await fireEvent.click(within(row).getByText('Actions for user2'));
		await fireEvent.click(within(row).getByRole('button', { name: 'Revoke reset link' }));
		await waitFor(() => expect(adminUsers.revokeResetLink).toHaveBeenCalledWith(2));
	});

	it('asks for the password before making someone admin', async () => {
		vi.mocked(adminUsers.patchUser).mockResolvedValue(dto(2) as never);
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		const row = screen.getByRole('row', { name: /user2/ });
		await fireEvent.click(within(row).getByText('Actions for user2'));
		await fireEvent.click(within(row).getByRole('button', { name: 'Make admin' }));
		expect(adminUsers.patchUser).not.toHaveBeenCalled();
		await fireEvent.input(await screen.findByLabelText(/Your own password, to confirm/), { target: { value: 'pw-pw-pw-pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		await waitFor(() => expect(adminUsers.patchUser).toHaveBeenCalledWith(2, { admin: true, currentPassword: 'pw-pw-pw-pw' }));
	});

	it('creates a user with a generated password and shows the must-change note', async () => {
		const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((b: Uint8Array) => {
			b.fill(3); // 'D' every time
			return b;
		}) as never);
		vi.mocked(adminUsers.createUser).mockResolvedValue(dto(3, { username: 'carla', mustChangePassword: true }) as never);
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'carla' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
		const pw = (screen.getByLabelText('Temporary password') as HTMLInputElement).value;
		expect(pw).toBe('DDDDDDDDDDDDDDDD');
		expect(getRandomValues).toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
		await waitFor(() =>
			expect(adminUsers.createUser).toHaveBeenCalledWith({ username: 'carla', password: pw, admin: false })
		);
		expect((await screen.findAllByRole('status')).map((n) => n.textContent).join(' ')).toContain(
			'They must choose a new password when they first sign in.'
		);
		getRandomValues.mockRestore();
	});

	it('shows the reset link once with Copy and forgets it on Close', async () => {
		vi.mocked(adminUsers.issueResetLink).mockResolvedValue({ path: '/reset#t=abc123', expiresAt: '2030-01-01T00:00:00Z' });
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		const row = screen.getByRole('row', { name: /user2/ });
		await fireEvent.click(within(row).getByText('Actions for user2'));
		await fireEvent.click(within(row).getByRole('button', { name: 'Reset link' }));
		await fireEvent.input(await screen.findByLabelText(/Your own password, to confirm/), { target: { value: 'my-own-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		const link = (await screen.findByLabelText('Reset link address')) as HTMLInputElement;
		expect(adminUsers.issueResetLink).toHaveBeenCalledWith(2, 'my-own-password');
		expect(link.value).toBe(`${location.origin}/reset#t=abc123`);
		expect(screen.getByText(/shown once/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/reset#t=abc123`));
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(screen.queryByLabelText('Reset link address')).toBeNull();
		expect(document.body.textContent).not.toContain('abc123');
	});

	it('disables the last administrator\'s dangerous actions with the reason as text', async () => {
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		expect(screen.getAllByText('The last administrator cannot be removed.').length).toBeGreaterThan(0);
		const row = screen.getByRole('row', { name: /user1/ });
		expect((within(row).getByRole('button', { name: 'Remove admin' }) as HTMLButtonElement).disabled).toBe(true);
		expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull(); // own row
	});

	it('delete dialog lists the preview counts and enables Delete only for the typed name', async () => {
		vi.mocked(adminUsers.deletionPreview).mockResolvedValue({
			workspaces: 2, studyEvents: 30, pluginData: 0, books: 1, journalPhotos: 0, aiKeys: 1, sessions: 1, overlays: 0, sentences: 0
		});
		vi.mocked(adminUsers.deleteUser).mockResolvedValue(undefined as never);
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		const row = screen.getByRole('row', { name: /user2/ });
		await fireEvent.click(within(row).getByText('Actions for user2'));
		await fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog', { hidden: true });
		await within(dialog).findByText('2 workspaces');
		const del = within(dialog).getByRole('button', { name: 'Delete account' }) as HTMLButtonElement;
		expect(del.disabled).toBe(true);
		await fireEvent.input(within(dialog).getByLabelText(/Type/), { target: { value: 'user' } });
		expect(del.disabled).toBe(true);
		await fireEvent.input(within(dialog).getByLabelText(/Type/), { target: { value: 'user2' } });
		expect(del.disabled).toBe(true); // the administrator's own password is needed too
		await fireEvent.input(within(dialog).getByLabelText('Your own password'), { target: { value: 'my-own-password' } });
		expect(del.disabled).toBe(false);
		await fireEvent.click(del);
		await waitFor(() => expect(adminUsers.deleteUser).toHaveBeenCalledWith(2, 'user2', 'my-own-password'));
	});
});

describe('UsersAdmin: reset two-step sign-in', () => {
	const signInAsAdmin = (totp: boolean) =>
		auth.set({
			token: 't',
			user: {
				id: 1, username: 'user1', admin: true, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't',
				mfa: { totp, email: false, recoveryCodesLeft: totp ? 10 : 0 }
			}
		});
	beforeEach(() => {
		vi.mocked(adminUsers.listUsers).mockResolvedValue([
			dto(1, { admin: true, mfa: { totp: true, email: false } }),
			dto(2, { mfa: { totp: true, email: true } }),
			dto(3, { mfa: { totp: false, email: false } })
		] as never);
	});

	async function open(): Promise<HTMLElement> {
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		const row = screen.getByRole('row', { name: /user2/ });
		await fireEvent.click(within(row).getByText('Actions for user2'));
		await fireEvent.click(within(row).getByRole('button', { name: 'Reset two-step sign-in' }));
		return screen.findByRole('dialog', { hidden: true });
	}

	it('is offered only for another user who has a second step', async () => {
		signInAsAdmin(false);
		render(UsersAdmin);
		await screen.findByRole('table', { name: 'Users' });
		expect(within(screen.getByRole('row', { name: /user1/ })).queryByRole('button', { name: 'Reset two-step sign-in', hidden: true })).toBeNull();
		expect(within(screen.getByRole('row', { name: /user3/ })).queryByRole('button', { name: 'Reset two-step sign-in', hidden: true })).toBeNull();
		expect(within(screen.getByRole('row', { name: /user2/ })).getByRole('button', { name: 'Reset two-step sign-in', hidden: true })).toBeTruthy();
	});

	it('says what is removed and revoked, asks for the password and resets', async () => {
		signInAsAdmin(false);
		vi.mocked(adminUsers.resetUserMfa).mockResolvedValue(undefined);
		const dialog = await open();
		const text = dialog.textContent ?? '';
		expect(text).toContain('Reset two-step sign-in for “user2”?');
		expect(text).toContain('authenticator app and all of its recovery codes');
		expect(text).toContain('Sign-in codes by email are turned off');
		expect(text).toContain('personal access tokens are revoked');
		expect(within(dialog).queryByLabelText(/Authenticator or recovery code/)).toBeNull();
		const password = within(dialog).getByLabelText('Your own password') as HTMLInputElement;
		expect(document.activeElement).toBe(password);
		const submit = within(dialog).getByRole('button', { name: 'Reset two-step sign-in', hidden: true }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		await fireEvent.input(password, { target: { value: 'my-own-password' } });
		expect(submit.disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() => expect(adminUsers.resetUserMfa).toHaveBeenCalledWith(2, 'my-own-password', undefined));
		await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
		expect(screen.getAllByRole('status').map((n) => n.textContent)).toContain('Two-step sign-in of user2 was reset; they were signed out everywhere.');
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Users' })));
		expect(adminUsers.listUsers).toHaveBeenCalledTimes(2);
	});

	it('asks an administrator with an authenticator for the code too', async () => {
		signInAsAdmin(true);
		vi.mocked(adminUsers.resetUserMfa).mockResolvedValue(undefined);
		const dialog = await open();
		const submit = within(dialog).getByRole('button', { name: 'Reset two-step sign-in', hidden: true }) as HTMLButtonElement;
		await fireEvent.input(within(dialog).getByLabelText('Your own password'), { target: { value: 'my-own-password' } });
		expect(submit.disabled).toBe(true);
		await fireEvent.input(within(dialog).getByLabelText(/Authenticator or recovery code/), { target: { value: ' 123456 ' } });
		expect(submit.disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() => expect(adminUsers.resetUserMfa).toHaveBeenCalledWith(2, 'my-own-password', '123456'));
	});

	it('shows a fixed sentence and focuses the field to fix after a refusal', async () => {
		signInAsAdmin(true);
		const dialog = await open();
		const password = within(dialog).getByLabelText('Your own password') as HTMLInputElement;
		const code = within(dialog).getByLabelText(/Authenticator or recovery code/) as HTMLInputElement;
		const submit = within(dialog).getByRole('button', { name: 'Reset two-step sign-in', hidden: true });
		await fireEvent.input(password, { target: { value: 'pw-1' } });
		await fireEvent.input(code, { target: { value: '111111' } });
		vi.mocked(adminUsers.resetUserMfa).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'code_invalid', message: 'server words' })));
		await fireEvent.click(submit);
		expect((await within(dialog).findByRole('alert')).textContent).toBe(
			'That code is not right. Use a current authenticator code or an unused recovery code.'
		);
		await waitFor(() => expect(document.activeElement).toBe(code));
		expect(code.value).toBe('');
		expect(password.value).toBe('pw-1');
		await fireEvent.input(code, { target: { value: '222222' } });
		vi.mocked(adminUsers.resetUserMfa).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'server words' })));
		await fireEvent.click(submit);
		await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Your password is wrong.'));
		await waitFor(() => expect(document.activeElement).toBe(password));
		expect(password.value).toBe('');
		expect(dialog.textContent).not.toContain('server words');
		expect(screen.getByRole('dialog', { hidden: true })).toBeTruthy();
	});

	it('Cancel closes without a request and gives focus back to the heading', async () => {
		signInAsAdmin(false);
		const dialog = await open();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel', hidden: true }));
		await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
		expect(adminUsers.resetUserMfa).not.toHaveBeenCalled();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Users' })));
	});

	it('reloads the list when the account is gone', async () => {
		signInAsAdmin(false);
		const dialog = await open();
		await fireEvent.input(within(dialog).getByLabelText('Your own password'), { target: { value: 'pw' } });
		vi.mocked(adminUsers.resetUserMfa).mockRejectedValueOnce(new ApiError(404, JSON.stringify({ error: 'not_found', message: 'No such user.' })));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Reset two-step sign-in', hidden: true }));
		expect((await within(dialog).findByRole('alert')).textContent).toBe('This account does not exist any more.');
		await waitFor(() => expect(adminUsers.listUsers).toHaveBeenCalledTimes(2));
	});
});
