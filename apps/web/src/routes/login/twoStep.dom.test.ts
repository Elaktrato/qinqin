import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

const fakes = vi.hoisted(() => ({ signIn: vi.fn(), completeMfa: vi.fn(), completeEmailLogin: vi.fn() }));
vi.mock('$lib/api/account', () => ({ getAuthOptions: vi.fn() }));
vi.mock('$lib/api/mfa', () => ({ mfaSendEmail: vi.fn(), emailLoginStart: vi.fn() }));

const { completeEmailLogin, completeMfa, signIn } = fakes;
import { getAuthOptions } from '$lib/api/account';
import { emailLoginStart, mfaSendEmail } from '$lib/api/mfa';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

let ctx: TestContext = testContext({ user: null });
beforeEach(() => {
	ctx = testContext({ user: null });
	Object.assign(ctx.app.auth, fakes);
});

const challenge = (methods: string[], emailHint: string | null = null) => ({
	kind: 'mfa' as const,
	mfa: { challenge: 'chal_example', methods, emailHint, expiresAt: '2026-11-15T12:10:00Z' }
});
const err = (status: number, body: object) => new ApiError(status, JSON.stringify(body));
const opts = (o: object = {}) =>
	({ registration: 'closed', emailPolicy: 'off', passwordReset: false, emailCodeLogin: false, passwordMinLength: 10, ...o }) as never;

beforeEach(() => {
	vi.mocked(getAuthOptions).mockResolvedValue(opts());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
});

async function toSecondStep(methods = ['totp', 'recovery'], hint: string | null = null) {
	vi.mocked(signIn).mockResolvedValue(challenge(methods, hint) as never);
	render(Page, { context: ctx.context });
	await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'owner' } });
	await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw' } });
	await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
	await screen.findByRole('heading', { name: 'Two-step check' });
	await screen.findByRole('button', { name: 'Continue' });
}

describe('two-step sign-in', () => {
	it('shows the code step with focus on its heading and the right input attributes', async () => {
		await toSecondStep();
		// one primary action per view (#106): the code step verifies
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Continue']);
		const heading = screen.getByRole('heading', { name: 'Two-step check' });
		await waitFor(() => expect(document.activeElement).toBe(heading));
		const input = screen.getByLabelText('Code from your authenticator app') as HTMLInputElement;
		expect(input.getAttribute('inputmode')).toBe('numeric');
		expect(input.getAttribute('autocomplete')).toBe('one-time-code');
		expect(input.getAttribute('maxlength')).toBe('6');
		await fireEvent.input(input, { target: { value: '123 456' } });
		expect(input.value).toBe('123456');
	});

	it('submits the code and leaves the page to the layout guard on success', async () => {
		await toSecondStep();
		vi.mocked(completeMfa).mockResolvedValue({ kind: 'session' } as never);
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await waitFor(() => expect(completeMfa).toHaveBeenCalledWith('chal_example', 'totp', '123456'));
	});

	it('keeps Continue disabled until the code is complete', async () => {
		await toSecondStep();
		const btn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '12345' } });
		expect(btn.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
		expect(btn.disabled).toBe(false);
	});

	it('switches to a recovery code and back', async () => {
		await toSecondStep();
		await fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
		const input = screen.getByLabelText('Recovery code') as HTMLInputElement;
		expect(input.getAttribute('autocomplete')).toBe('off');
		vi.mocked(completeMfa).mockResolvedValue({ kind: 'session' } as never);
		await fireEvent.input(input, { target: { value: 'abcd efgh ijkl mnop' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await waitFor(() => expect(completeMfa).toHaveBeenCalledWith('chal_example', 'recovery', 'ABCDEFGHIJKLMNOP'));
		expect(screen.getByRole('button', { name: 'Use my authenticator app' })).toBeTruthy();
	});

	it('puts the attempts left in the error', async () => {
		await toSecondStep();
		vi.mocked(completeMfa).mockRejectedValue(err(401, { error: 'code_invalid', message: 'x', attemptsLeft: 3 }));
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '000000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		expect((await screen.findByRole('alert')).textContent).toBe('That code is not right. 3 attempts left.');
	});

	it('returns to step one with a sentence when the challenge is gone', async () => {
		await toSecondStep();
		vi.mocked(completeMfa).mockRejectedValue(err(401, { error: 'challenge_expired', message: 'x' }));
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '000000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('heading', { name: 'Sign in' });
		expect((await screen.findByRole('status')).textContent).toContain('Enter your details again');
	});

	it('offers an emailed code, shows the masked address and a 60 s resend countdown', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await toSecondStep(['totp', 'recovery', 'email'], 'b•••@e•••.org');
		vi.mocked(mfaSendEmail).mockResolvedValue({ resendAfter: 60 });
		await fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }));
		await waitFor(() => expect(mfaSendEmail).toHaveBeenCalledWith('chal_example'));
		expect(await screen.findByText('b•••@e•••.org')).toBeTruthy();
		expect(screen.getByText(/ask for a new code in 60 seconds/)).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement).disabled).toBe(true);
		expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(61000);
		await waitFor(() => expect((screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement).disabled).toBe(false));
		expect(screen.getByText(/ask for a new code now/)).toBeTruthy();
	});
});

describe('sign-in by emailed code', () => {
	it('offers the link only when the instance allows it', async () => {
		render(Page, { context: ctx.context });
		await screen.findByRole('heading', { name: 'Sign in' });
		expect(screen.queryByRole('button', { name: 'Email me a sign-in code' })).toBeNull();
		cleanup();
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ emailCodeLogin: true }));
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('button', { name: 'Email me a sign-in code' })).toBeTruthy();
	});

	it('asks for the identifier, then the code, and signs in', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ emailCodeLogin: true }));
		vi.mocked(emailLoginStart).mockResolvedValue({ challenge: 'el_example', resendAfter: 60, expiresAt: 'x' });
		vi.mocked(completeEmailLogin).mockResolvedValue({ kind: 'session' } as never);
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
		// the email start step: one primary action and a Field for the identifier
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Email me a code']);
		const login = screen.getByLabelText('Username or email address');
		expect(login.closest('.field')).not.toBeNull();
		await fireEvent.input(login, { target: { value: ' owner ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
		await screen.findByRole('heading', { name: 'Enter your code' });
		// the email code step: one primary action (the submit, still busy here)
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(emailLoginStart).toHaveBeenCalledWith('owner');
		// the same sentence whoever the account is
		expect(screen.getByText(/If the account has a confirmed email address/)).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Code from the email'), { target: { value: '654321' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await waitFor(() => expect(completeEmailLogin).toHaveBeenCalledWith('el_example', '654321'));
	});

	it('continues with the authenticator when the code leads to a second step', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ emailCodeLogin: true }));
		vi.mocked(emailLoginStart).mockResolvedValue({ challenge: 'el_example', resendAfter: 60, expiresAt: 'x' });
		vi.mocked(completeEmailLogin).mockResolvedValue(challenge(['totp', 'recovery']) as never);
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
		await fireEvent.input(screen.getByLabelText('Username or email address'), { target: { value: 'owner' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
		await fireEvent.input(await screen.findByLabelText('Code from the email'), { target: { value: '654321' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await screen.findByRole('heading', { name: 'Two-step check' });
	});

	it('shows the server sentence for a rate limit on the start', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ emailCodeLogin: true }));
		vi.mocked(emailLoginStart).mockRejectedValue(new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Try again in 5 minutes.' }), 300));
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
		await fireEvent.input(screen.getByLabelText('Username or email address'), { target: { value: 'owner' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
		expect((await screen.findByRole('alert')).textContent).toContain('Try again in 5 minutes');
	});
});
