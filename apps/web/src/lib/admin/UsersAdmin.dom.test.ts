import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/adminUsers', () => ({
	listUsers: vi.fn(),
	createUser: vi.fn(),
	patchUser: vi.fn(),
	revokeUserSessions: vi.fn(),
	issueResetLink: vi.fn(),
	revokeResetLink: vi.fn(),
	deletionPreview: vi.fn(),
	deleteUser: vi.fn()
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
