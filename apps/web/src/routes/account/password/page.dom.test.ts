import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { ApiError, api } from '$lib/api/client';
import { auth, restriction } from '$lib/auth';
import Page from './+page.svelte';

const restricted = {
	id: 1,
	username: 'bobby',
	admin: false,
	email: null,
	emailVerified: false,
	mustChangePassword: true,
	createdAt: 't',
	restriction: 'password_change' as const
};

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tok');
	auth.set({ token: 'tok', user: restricted });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function fill(next: string, confirm: string) {
	await fireEvent.input(screen.getByLabelText('New password'), { target: { value: next } });
	await fireEvent.input(screen.getByLabelText('Repeat the new password'), {
		target: { value: confirm }
	});
}

describe('forced password change page', () => {
	it('explains why and shows the policy', () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
		expect(screen.getByText('At least 10 characters. No other rules.')).toBeTruthy();
	});

	it('says when the two passwords differ and does not send', async () => {
		render(Page);
		await fill('a-long-password-1', 'a-long-password-2');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The two passwords do not match.');
		expect(api).not.toHaveBeenCalled();
	});

	it('says when the password is too short and does not send', async () => {
		render(Page);
		await fill('short', 'short');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Use at least 10 characters.');
		expect(api).not.toHaveBeenCalled();
	});

	it('changes the password, reloads the session as a full one and goes home', async () => {
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/account/password') return { status: 'ok' };
			if (url === '/api/auth/me') return { ...restricted, mustChangePassword: false, restriction: '' };
			throw new Error(url);
		}) as never);
		render(Page);
		await fill('a-long-password-1', 'a-long-password-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/password');
		expect(call?.[1]).toMatchObject({
			method: 'POST',
			body: { newPassword: 'a-long-password-1', signOutOthers: true }
		});
		expect(get(restriction)).toBeNull();
	});

	it('asks for the current password when the server wants it', async () => {
		vi.mocked(api).mockRejectedValueOnce(
			new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' }))
		);
		render(Page);
		await fill('a-long-password-1', 'a-long-password-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe(
			'Enter your current password to continue.'
		);
		expect(screen.getByLabelText('Current password')).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();
		// The session is still signed in: a 403 must not be treated as 401.
		expect(get(auth).token).toBe('tok');
	});

	it('shows the server sentence for a rejected password', async () => {
		vi.mocked(api).mockRejectedValueOnce(
			new ApiError(422, JSON.stringify({ error: 'weak_password', message: 'Nope, too weak.' }))
		);
		render(Page);
		await fill('a-long-password-1', 'a-long-password-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Nope, too weak.');
	});

	it('asks for the current password up front when me says so, and sends it', async () => {
		auth.set({ token: 'tok', user: { ...restricted, needsCurrentPassword: true } });
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/account/password') return { status: 'ok' };
			return { ...restricted, mustChangePassword: false, restriction: '' };
		}) as never);
		render(Page);
		await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'temp-secret-1' } });
		await fill('a-long-password-1', 'a-long-password-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		await waitFor(() => expect(goto).toHaveBeenCalled());
		const call = vi.mocked(api).mock.calls.find(([u]) => u === '/api/account/password');
		expect(call?.[1]).toMatchObject({ body: { currentPassword: 'temp-secret-1' } });
	});

	it('shows no current-password field for the temporary-password session', () => {
		auth.set({ token: 'tok', user: { ...restricted, needsCurrentPassword: false } });
		render(Page);
		expect(screen.queryByLabelText('Current password')).toBeNull();
	});
});
