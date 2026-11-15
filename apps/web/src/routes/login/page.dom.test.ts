import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/auth', () => ({ login: vi.fn() }));
vi.mock('$lib/api/account', () => ({ getAuthOptions: vi.fn() }));

import { login } from '$lib/auth';
import { getAuthOptions } from '$lib/api/account';
import Page from './+page.svelte';

beforeEach(() => {
	vi.mocked(getAuthOptions).mockRejectedValue(new Error('offline'));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function submit() {
	await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'owner' } });
	await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw' } });
	await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login page throttling', () => {
	it('shows the wait, keeps the button enabled and sends no second request', async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'm' }), 6)
		);
		render(Page);
		await submit();
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('Too many sign-in attempts. Try again in 6 seconds.');
		await waitFor(() =>
			expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
				false
			)
		);
		await new Promise((r) => setTimeout(r, 20));
		expect(login).toHaveBeenCalledTimes(1);
	});

	it('shows wrong credentials from the JSON body', async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError(401, JSON.stringify({ error: 'bad_credentials', message: 'x' }))
		);
		render(Page);
		await submit();
		expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password.');
	});

	it('shows the disabled-account sentence for 403 account_disabled', async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError(403, JSON.stringify({ error: 'account_disabled', message: 'x' }))
		);
		render(Page);
		await submit();
		expect((await screen.findByRole('alert')).textContent).toBe(
			'This account is disabled. Ask an administrator to enable it.'
		);
	});
});

describe('login page links follow the instance options', () => {
	const opts = (o: object) => ({
		bootstrap: false,
		registration: 'closed',
		emailPolicy: 'off',
		passwordReset: false,
		emailCodeLogin: false,
		passwordMinLength: 10,
		...o
	});
	it('offers account creation on a fresh instance and in open mode', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ bootstrap: true }) as never);
		render(Page);
		expect(await screen.findByRole('link', { name: 'Create one' })).toBeTruthy();
		cleanup();
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'open' }) as never);
		render(Page);
		expect(await screen.findByRole('link', { name: 'Create one' })).toBeTruthy();
	});
	it('tells invite-only visitors to open their link, and offers nothing when closed', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'invite' }) as never);
		render(Page);
		expect(await screen.findByText('Have an invite link? Open it to register.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Create one' })).toBeNull();
		cleanup();
		vi.mocked(getAuthOptions).mockResolvedValue(opts({}) as never);
		render(Page);
		await screen.findByText(/Ask your administrator for a reset link/);
		expect(screen.queryByRole('link', { name: 'Create one' })).toBeNull();
		expect(screen.queryByText(/invite link/)).toBeNull();
	});
	it('shows Forgot password only when mail can reset passwords', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ passwordReset: true }) as never);
		render(Page);
		expect(await screen.findByRole('link', { name: 'Forgot password?' })).toBeTruthy();
	});
});
