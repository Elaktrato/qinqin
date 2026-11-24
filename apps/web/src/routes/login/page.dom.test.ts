import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

const fakes = vi.hoisted(() => ({ signIn: vi.fn(), completeMfa: vi.fn(), completeEmailLogin: vi.fn() }));
vi.mock('$lib/api/account', () => ({ getAuthOptions: vi.fn() }));
vi.mock('$lib/api/mfa', () => ({ mfaSendEmail: vi.fn(), emailLoginStart: vi.fn() }));

const { signIn: login } = fakes;
import { getAuthOptions } from '$lib/api/account';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

let ctx: TestContext = testContext({ user: null });
beforeEach(() => {
	ctx = testContext({ user: null });
	Object.assign(ctx.app.auth, fakes);
});

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

describe('the sign-in views in the lighter look (#106)', () => {
	it('the password step has one primary action, "Sign in"', async () => {
		render(Page, { context: ctx.context });
		const submit = screen.getByRole('button', { name: 'Sign in' });
		expect(primaryActions(document.body)).toEqual([submit]);
	});

	it('the username and password are Field underlines with their labels', async () => {
		render(Page, { context: ctx.context });
		expect(screen.getByLabelText('Username').closest('.field')).not.toBeNull();
		expect(screen.getByLabelText('Password').closest('.field')).not.toBeNull();
	});

	it('the other-method signs are plain text, not a second button style', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue({
			bootstrap: false,
			registration: 'closed',
			emailPolicy: 'off',
			passwordReset: true,
			emailCodeLogin: true,
			passwordMinLength: 10
		} as never);
		render(Page, { context: ctx.context });
		const email = await screen.findByRole('button', { name: 'Email me a sign-in code' });
		expect(email.className).toContain('plain');
		expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeTruthy();
	});
});

describe('login page throttling', () => {
	it('shows the wait, keeps the button enabled and sends no second request', async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'm' }), 6)
		);
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
		await submit();
		expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password.');
	});

	it('shows the disabled-account sentence for 403 account_disabled', async () => {
		vi.mocked(login).mockRejectedValue(
			new ApiError(403, JSON.stringify({ error: 'account_disabled', message: 'x' }))
		);
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('link', { name: 'Create one' })).toBeTruthy();
		cleanup();
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'open' }) as never);
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('link', { name: 'Create one' })).toBeTruthy();
	});
	it('tells invite-only visitors to open their link, and offers nothing when closed', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'invite' }) as never);
		render(Page, { context: ctx.context });
		expect(await screen.findByText('Have an invite link? Open it to register.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Create one' })).toBeNull();
		cleanup();
		vi.mocked(getAuthOptions).mockResolvedValue(opts({}) as never);
		render(Page, { context: ctx.context });
		await screen.findByText(/Ask your administrator for a reset link/);
		expect(screen.queryByRole('link', { name: 'Create one' })).toBeNull();
		expect(screen.queryByText(/invite link/)).toBeNull();
	});
	it('shows Forgot password only when mail can reset passwords', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ passwordReset: true }) as never);
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('link', { name: 'Forgot password?' })).toBeTruthy();
	});
});
