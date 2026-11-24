import { testContext, testUser, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';


vi.mock('$lib/api/adminSettings', () => ({ getSmtp: vi.fn(), putSmtp: vi.fn(), deleteSmtp: vi.fn(), testSmtp: vi.fn() }));
import * as api from '$lib/api/adminSettings';
import { primaryActions } from '$lib/ui/testing/primary';
import EmailAdmin from './EmailAdmin.svelte';

const initial = { username: 'owner', mfa: { totp: false } };
let ctx: TestContext = testContext({ user: initial as never });
beforeEach(() => {
	ctx = testContext({ user: initial as never });
});
/** The signed-in user, as `me` answered it. */
const me = { set: (user: Record<string, unknown>) => ctx.app.auth.set({ token: 'test-token', user: testUser(user as never) }) };

const saved = (o: object = {}) => ({ configured: true, host: 'mail.example.org', port: 587, tls: 'starttls', username: 'u', password: 'set',
	fromAddress: 'q@example.org', fromName: 'qinqin', publicUrl: 'https://x.example.org', secret: 'ok', allowPrivate: false, updatedAt: 't', ...o });

beforeEach(() => vi.mocked(api.getSmtp).mockResolvedValue(saved() as never));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('EmailAdmin', () => {
	it('has one primary Save; text fields and TLS are base controls', async () => {
		render(EmailAdmin, { context: ctx.context });
		await screen.findByText('A password is saved.');
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Save' }).className).toContain('primary');
		expect(screen.getByLabelText('Server').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Connection security').closest('.field')).toBeTruthy();
	});

	it('says a password is saved, never prefills it, and saves without the key', async () => {
		vi.mocked(api.putSmtp).mockResolvedValue(saved() as never);
		render(EmailAdmin, { context: ctx.context });
		expect(await screen.findByText('A password is saved.')).toBeTruthy();
		expect(document.querySelector('input[name=password]')).toBeNull();
		await fireEvent.input(screen.getByLabelText(/Your own password, to save/), { target: { value: 'my-pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(api.putSmtp).toHaveBeenCalled());
		expect('password' in vi.mocked(api.putSmtp).mock.calls[0][0]).toBe(false);
	});
	it('Replace shows an empty field; Remove sends an empty password', async () => {
		vi.mocked(api.putSmtp).mockResolvedValue(saved({ password: 'none' }) as never);
		render(EmailAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
		await fireEvent.input(screen.getByLabelText(/Your own password, to save/), { target: { value: 'my-pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(vi.mocked(api.putSmtp).mock.calls[0][0].password).toBe(''));
	});
	it('warns about plain text and moves the default port', async () => {
		render(EmailAdmin, { context: ctx.context });
		await fireEvent.change(await screen.findByLabelText('Connection security'), { target: { value: 'none' } });
		expect(screen.getByRole('note').textContent).toContain('without encryption');
		expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('25');
	});
	it('shows the success and failure sentences of the test mail', async () => {
		vi.mocked(api.testSmtp).mockResolvedValueOnce({ sent: true });
		render(EmailAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Send test mail' }));
		expect((await screen.findByRole('status')).textContent).toContain('Test mail sent');
		vi.mocked(api.testSmtp).mockRejectedValueOnce(new ApiError(502, JSON.stringify({ error: 'smtp_test_failed', category: 'auth', smtpCode: 535, message: 'x' })));
		await fireEvent.click(screen.getByRole('button', { name: 'Send test mail' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The server refused the user name or password. (server reply 535)');
	});

	it('warns when people depend on mail that does not work', async () => {
		vi.mocked(api.getSmtp).mockResolvedValue(saved({ configured: false, usersDependOnMail: 2 }) as never);
		render(EmailAdmin, { context: ctx.context });
		expect((await screen.findByRole('alert')).textContent).toContain('2 people have email codes as their only second step');
	});
	it('stays quiet when mail works', async () => {
		vi.mocked(api.getSmtp).mockResolvedValue(saved({ usersDependOnMail: 2 }) as never);
		render(EmailAdmin, { context: ctx.context });
		await screen.findByText('A password is saved.');
		expect(screen.queryByRole('alert')).toBeNull();
	});
});

describe('EmailAdmin: saving and removing re-authenticate', () => {
	it('sends the own password (and code) with the settings; Save waits for them', async () => {
		me.set({ username: 'owner', mfa: { totp: true } });
		vi.mocked(api.putSmtp).mockResolvedValue(saved() as never);
		render(EmailAdmin, { context: ctx.context });
		const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText(/Your own password, to save/), { target: { value: 'my-pw' } });
		expect(save.disabled).toBe(true);
		const code = screen.getByLabelText(/Authenticator or recovery code/) as HTMLInputElement;
		expect(code.getAttribute('spellcheck')).toBe('false');
		await fireEvent.input(code, { target: { value: '123456' } });
		await fireEvent.click(save);
		await waitFor(() => expect(api.putSmtp).toHaveBeenCalled());
		expect(vi.mocked(api.putSmtp).mock.calls[0][0]).toMatchObject({ currentPassword: 'my-pw', code: '123456', host: 'mail.example.org' });
		me.set({ username: 'owner', mfa: { totp: false } });
	});
	it('a wrong own password is said in a fixed sentence and focuses the field', async () => {
		render(EmailAdmin, { context: ctx.context });
		const own = (await screen.findByLabelText(/Your own password, to save/)) as HTMLInputElement;
		await fireEvent.input(own, { target: { value: 'bad' } });
		vi.mocked(api.putSmtp).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' })));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Your password is wrong.');
		await waitFor(() => expect(document.activeElement).toBe(own));
		expect(own.value).toBe('');
	});
	it('removing asks for the own password and sends it', async () => {
		vi.mocked(api.deleteSmtp).mockResolvedValue(undefined);
		render(EmailAdmin, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove email setup…' }));
		const yes = screen.getByRole('button', { name: 'Yes, remove' }) as HTMLButtonElement;
		expect(yes.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText(/Your own password, to remove/), { target: { value: 'my-pw' } });
		await fireEvent.click(yes);
		await waitFor(() => expect(api.deleteSmtp).toHaveBeenCalledWith({ currentPassword: 'my-pw' }));
	});
});
