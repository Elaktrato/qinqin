import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/auth', () => ({ signInWithToken: vi.fn() }));
vi.mock('$lib/api/account', () => ({ checkReset: vi.fn(), useReset: vi.fn() }));

import { signInWithToken } from '$lib/auth';
import { checkReset, useReset } from '$lib/api/account';
import Page from './+page.svelte';

beforeEach(() => {
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
});
