import { testContext, testUser, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/api/adminSettings', () => ({
	getAuthSettings: vi.fn(),
	patchAuthSettings: vi.fn(),
	listAudit: vi.fn()
}));

import * as api from '$lib/api/adminSettings';
import SecurityAdmin from './SecurityAdmin.svelte';

const initial = { username: 'owner', mfa: { totp: false } };
let ctx: TestContext = testContext({ user: initial as never });
beforeEach(() => {
	ctx = testContext({ user: initial as never });
});
/** The signed-in user, as `me` answered it. */
const me = { set: (user: Record<string, unknown>) => ctx.app.auth.set({ token: 'test-token', user: testUser(user as never) }) };

const settings = (o: object = {}) => ({
	registration: 'closed', emailPolicy: 'off', mfaEnforced: false, emailCodeLogin: false, mail: { configured: false }, ...o
});
const ev = (id: number) => ({ id, at: '2026-11-15T10:00:00Z', action: 'user_created', actor: { id: 1, name: 'alice' }, target: { id: 2, name: 'bobby' }, detail: {} });

beforeEach(() => {
	vi.mocked(api.getAuthSettings).mockResolvedValue(settings() as never);
	vi.mocked(api.listAudit).mockResolvedValue({ events: [ev(9), ev(8)], next: 8 } as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('SecurityAdmin', () => {
	it('sends the registration choice and announces it', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue(settings({ registration: 'open' }) as never);
		vi.mocked(api.patchAuthSettings).mockResolvedValue(settings({ registration: 'invite' }) as never);
		render(SecurityAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('radio', { name: /By invite/ }));
		// closing down from open tightens: no password
		await waitFor(() => expect(api.patchAuthSettings).toHaveBeenCalledWith({ registration: 'invite' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Registration is now by invite'));
	});

	it('hides the MFA and email-code switches behind the needs-email sentence', async () => {
		render(SecurityAdmin, { context: ctx.context });
		await screen.findByRole('radio', { name: /Closed/ });
		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(screen.getByText(/Needs email/)).toBeTruthy();
	});

	it('shows the switches when mail is configured', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue(settings({ mail: { configured: true } }) as never);
		render(SecurityAdmin, { context: ctx.context });
		expect(await screen.findByRole('checkbox', { name: /Require two-factor/ })).toBeTruthy();
	});

	it('pages the audit list with Load older', async () => {
		vi.mocked(api.listAudit).mockResolvedValueOnce({ events: [ev(9), ev(8)], next: 8 } as never);
		vi.mocked(api.listAudit).mockResolvedValueOnce({ events: [ev(7)], next: null } as never);
		render(SecurityAdmin, { context: ctx.context });
		const list = await screen.findByRole('list', { name: 'Recent activity' });
		expect(list.querySelectorAll('li')).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
		await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(3));
		expect(api.listAudit).toHaveBeenLastCalledWith(8);
		expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
	});
});

describe('SecurityAdmin: lowering a protection re-authenticates', () => {
	it('asks for the password (and code) before opening registration, and sends them', async () => {
		me.set({ username: 'owner', mfa: { totp: true } });
		vi.mocked(api.patchAuthSettings).mockResolvedValue(settings({ registration: 'open' }) as never);
		render(SecurityAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('radio', { name: /Open/ }));
		expect(api.patchAuthSettings).not.toHaveBeenCalled();
		const form = await screen.findByRole('form', { name: 'Confirm with your password' });
		const confirm = within(form).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
		await fireEvent.input(within(form).getByLabelText(/Your own password/), { target: { value: 'pw-pw' } });
		expect(confirm.disabled).toBe(true);
		await fireEvent.input(within(form).getByLabelText(/Authenticator or recovery code/), { target: { value: '123456' } });
		await fireEvent.click(confirm);
		await waitFor(() => expect(api.patchAuthSettings).toHaveBeenCalledWith({ registration: 'open', currentPassword: 'pw-pw', code: '123456' }));
		await waitFor(() => expect(screen.queryByRole('form', { name: 'Confirm with your password' })).toBeNull());
		me.set({ username: 'owner', mfa: { totp: false } });
	});
	it('keeps the form on a wrong password and Cancel changes nothing', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue(settings({ mail: { configured: true }, emailCodeLogin: false }) as never);
		render(SecurityAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('checkbox', { name: /Allow signing in with an emailed code/ }));
		const form = await screen.findByRole('form', { name: 'Confirm with your password' });
		await fireEvent.input(within(form).getByLabelText(/Your own password/), { target: { value: 'bad' } });
		vi.mocked(api.patchAuthSettings).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' })));
		await fireEvent.click(within(form).getByRole('button', { name: 'Confirm' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Your password is wrong.');
		expect(screen.getByRole('form', { name: 'Confirm with your password' })).toBeTruthy();
		await fireEvent.click(within(screen.getByRole('form', { name: 'Confirm with your password' })).getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('form', { name: 'Confirm with your password' })).toBeNull();
		expect((screen.getByRole('checkbox', { name: /Allow signing in with an emailed code/ }) as HTMLInputElement).checked).toBe(false);
		expect(api.patchAuthSettings).toHaveBeenCalledTimes(1);
	});
	it('turns enforcement on without a password, but signing everyone out asks', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue(settings({ mail: { configured: true } }) as never);
		vi.mocked(api.patchAuthSettings).mockResolvedValue(settings({ mail: { configured: true }, mfaEnforced: true }) as never);
		render(SecurityAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('checkbox', { name: /Require two-factor/ }));
		await waitFor(() => expect(api.patchAuthSettings).toHaveBeenCalledWith({ mfaEnforced: true }));
	});
});
