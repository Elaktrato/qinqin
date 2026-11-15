import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/auth', () => ({ login: vi.fn() }));

import { login } from '$lib/auth';
import Page from './+page.svelte';

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
