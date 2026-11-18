import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/auth', () => ({ signInWithToken: vi.fn() }));
vi.mock('$lib/api/account', () => ({ checkReset: vi.fn(), useReset: vi.fn(), getAuthOptions: vi.fn() }));
vi.mock('$lib/api/mfa', () => ({ resetRequest: vi.fn() }));

import { signInWithToken } from '$lib/auth';
import { checkReset, getAuthOptions, useReset } from '$lib/api/account';
import { resetRequest } from '$lib/api/mfa';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

beforeEach(() => {
	vi.mocked(getAuthOptions).mockResolvedValue({ passwordReset: false } as never);
	vi.spyOn(history, 'replaceState');
	location.hash = '';
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	location.hash = '';
});

describe('reset page', () => {
	it('with a token: form, then signs in with the new session and goes home', async () => {
		location.hash = '#t=reset-token';
		vi.mocked(checkReset).mockResolvedValue({ username: 'bobby', expiresAt: 'x' });
		vi.mocked(useReset).mockResolvedValue({ status: 'ok', token: 'new-session' });
		render(Page);
		await screen.findByText('bobby');
		expect(history.replaceState).toHaveBeenCalled();
		// the set-password view: one primary action, both passwords Field underlines (#106)
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual([
			'Set password and sign in'
		]);
		expect(screen.getByLabelText('New password').closest('.field')).not.toBeNull();
		expect(screen.getByLabelText('Repeat the new password').closest('.field')).not.toBeNull();
		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'brand-new-password' } });
		await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'brand-new-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
		await waitFor(() => expect(signInWithToken).toHaveBeenCalledWith('new-session'));
		expect(useReset).toHaveBeenCalledWith('reset-token', 'brand-new-password');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('refuses a mismatching confirmation without a request', async () => {
		location.hash = '#t=reset-token';
		vi.mocked(checkReset).mockResolvedValue({ username: 'bobby', expiresAt: 'x' });
		render(Page);
		await screen.findByText('bobby');
		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'brand-new-password' } });
		await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'different-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
		expect((await screen.findByRole('alert')).textContent).toContain('do not match');
		expect(useReset).not.toHaveBeenCalled();
	});

	it('shows the one sentence for a bad link', async () => {
		location.hash = '#t=dead';
		vi.mocked(checkReset).mockRejectedValue(new ApiError(400, JSON.stringify({ error: 'token_invalid', message: 'x' })));
		render(Page);
		expect((await screen.findByRole('alert')).textContent).toContain('not valid any more');
	});

	it('without a link: ask the administrator', async () => {
		render(Page);
		expect(await screen.findByText(/Ask your administrator for a reset link/)).toBeTruthy();
		expect(checkReset).not.toHaveBeenCalled();
	});

	it('without a link and with mail: asks for the account and always shows the same sentence', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue({ passwordReset: true } as never);
		vi.mocked(resetRequest).mockResolvedValue({});
		render(Page);
		const login = await screen.findByLabelText('Username or email address');
		expect(login.closest('.field')).not.toBeNull();
		// the request view: one primary action (#106)
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Send reset link']);
		await fireEvent.input(login, { target: { value: ' nobody-here ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
		const status = await screen.findByRole('status');
		expect(status.textContent).toBe('If the account has a verified email address, we sent a link to reset the password. It works for one hour.');
		expect(resetRequest).toHaveBeenCalledWith('nobody-here');
	});

	it('shows a rate limit instead of the sentence', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue({ passwordReset: true } as never);
		vi.mocked(resetRequest).mockRejectedValue(new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Try again in 5 minutes.' }), 300));
		render(Page);
		await fireEvent.input(await screen.findByLabelText('Username or email address'), { target: { value: 'bobby' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
		expect((await screen.findByRole('alert')).textContent).toContain('Try again in');
	});

	it('a user with two-step sign-in finishes on the sign-in page and gets no session here', async () => {
		location.hash = '#t=reset-token';
		vi.mocked(checkReset).mockResolvedValue({ username: 'bobby', expiresAt: 'x' });
		vi.mocked(useReset).mockResolvedValue({ status: 'mfa_required', challenge: 'c', methods: ['totp', 'recovery'], emailHint: null, expiresAt: 'x' });
		render(Page);
		await screen.findByText('bobby');
		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'brand-new-password' } });
		await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'brand-new-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
		expect((await screen.findByRole('status')).textContent).toContain('second step');
		expect(signInWithToken).not.toHaveBeenCalled();
		expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeTruthy();
	});

	it('a reset that left no session (second step by email) points to the sign-in page', async () => {
		location.hash = '#t=reset-token';
		vi.mocked(checkReset).mockResolvedValue({ username: 'bobby', expiresAt: 'x' });
		vi.mocked(useReset).mockResolvedValue({ status: 'password_changed' });
		render(Page);
		await screen.findByText('bobby');
		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'brand-new-password' } });
		await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'brand-new-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
		expect((await screen.findByRole('status')).textContent).toContain('second step');
		expect(signInWithToken).not.toHaveBeenCalled();
	});
});
