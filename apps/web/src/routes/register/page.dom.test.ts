import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/auth', () => ({ register: vi.fn() }));
vi.mock('$lib/api/account', () => ({ getAuthOptions: vi.fn(), checkInvite: vi.fn() }));

import { register } from '$lib/auth';
import { checkInvite, getAuthOptions } from '$lib/api/account';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

const opts = (o: object) => ({
	bootstrap: false,
	registration: 'closed',
	emailPolicy: 'off',
	passwordReset: false,
	emailCodeLogin: false,
	passwordMinLength: 10,
	...o
});

let replaceState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	replaceState = vi.spyOn(history, 'replaceState');
	location.hash = '';
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	replaceState.mockRestore();
	location.hash = '';
});

describe('register page', () => {
	it('shows the closed sentence and no form when registration is closed', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({}) as never);
		render(Page);
		expect(await screen.findByText(/Registration is closed/)).toBeTruthy();
		expect(screen.queryByLabelText('Username')).toBeNull();
	});

	it('shows the form with the bootstrap notice on a fresh instance', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ bootstrap: true }) as never);
		render(Page);
		expect(await screen.findByLabelText('Username')).toBeTruthy();
		expect(screen.getByText(/first account becomes the administrator/)).toBeTruthy();
	});

	it('checks the invite from the fragment, strips it and registers with it', async () => {
		location.hash = '#invite=tok-123';
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'invite', emailPolicy: 'optional' }) as never);
		vi.mocked(checkInvite).mockResolvedValue({ expiresAt: null, emailPolicy: 'required' });
		vi.mocked(register).mockResolvedValue({} as never);
		render(Page);
		await screen.findByLabelText('Username');
		expect(checkInvite).toHaveBeenCalledWith('tok-123');
		expect(replaceState).toHaveBeenCalledWith(null, '', expect.not.stringContaining('#'));
		// the invite's own policy decides the email field (required here)
		const email = screen.getByLabelText('Email') as HTMLInputElement;
		expect(email.required).toBe(true);
		await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'newcomer' } });
		await fireEvent.input(email, { target: { value: 'n@example.org' } });
		// one primary action on the register view, and Field underlines (#106)
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Create account']);
		expect(screen.getByLabelText('Username').closest('.field')).not.toBeNull();
		expect(screen.getByLabelText('Password').closest('.field')).not.toBeNull();
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'long-enough-pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
		await waitFor(() =>
			expect(register).toHaveBeenCalledWith('newcomer', 'long-enough-pw', { email: 'n@example.org', invite: 'tok-123' })
		);
	});

	it('shows the sentence for an invalid invite and no form', async () => {
		location.hash = '#invite=dead';
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'invite' }) as never);
		vi.mocked(checkInvite).mockRejectedValue(
			new ApiError(403, JSON.stringify({ error: 'invite_invalid', message: 'x' }))
		);
		render(Page);
		expect((await screen.findByRole('alert')).textContent).toBe('This invite link is no longer valid.');
		expect(screen.queryByLabelText('Username')).toBeNull();
	});

	it('asks for an invite link in invite mode without one', async () => {
		vi.mocked(getAuthOptions).mockResolvedValue(opts({ registration: 'invite' }) as never);
		render(Page);
		expect(await screen.findByText(/You need an invite link/)).toBeTruthy();
	});
});
