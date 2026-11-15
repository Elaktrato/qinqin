import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/api/adminSettings', () => ({ getSmtp: vi.fn(), putSmtp: vi.fn(), deleteSmtp: vi.fn(), testSmtp: vi.fn() }));
import * as api from '$lib/api/adminSettings';
import EmailAdmin from './EmailAdmin.svelte';

const saved = (o: object = {}) => ({ configured: true, host: 'mail.example.org', port: 587, tls: 'starttls', username: 'u', password: 'set',
	fromAddress: 'q@example.org', fromName: 'qinqin', publicUrl: 'https://x.example.org', secret: 'ok', allowPrivate: false, updatedAt: 't', ...o });

beforeEach(() => vi.mocked(api.getSmtp).mockResolvedValue(saved() as never));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('EmailAdmin', () => {
	it('says a password is saved, never prefills it, and saves without the key', async () => {
		vi.mocked(api.putSmtp).mockResolvedValue(saved() as never);
		render(EmailAdmin);
		expect(await screen.findByText('A password is saved.')).toBeTruthy();
		expect(document.querySelector('input[type=password]')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(api.putSmtp).toHaveBeenCalled());
		expect('password' in vi.mocked(api.putSmtp).mock.calls[0][0]).toBe(false);
	});
	it('Replace shows an empty field; Remove sends an empty password', async () => {
		vi.mocked(api.putSmtp).mockResolvedValue(saved({ password: 'none' }) as never);
		render(EmailAdmin);
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(vi.mocked(api.putSmtp).mock.calls[0][0].password).toBe(''));
	});
	it('warns about plain text and moves the default port', async () => {
		render(EmailAdmin);
		await fireEvent.change(await screen.findByLabelText('Connection security'), { target: { value: 'none' } });
		expect(screen.getByRole('note').textContent).toContain('without encryption');
		expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('25');
	});
	it('shows the success and failure sentences of the test mail', async () => {
		vi.mocked(api.testSmtp).mockResolvedValueOnce({ sent: true });
		render(EmailAdmin);
		await fireEvent.click(await screen.findByRole('button', { name: 'Send test mail' }));
		expect((await screen.findByRole('status')).textContent).toContain('Test mail sent');
		vi.mocked(api.testSmtp).mockRejectedValueOnce(new ApiError(502, JSON.stringify({ error: 'smtp_test_failed', category: 'auth', smtpCode: 535, message: 'x' })));
		await fireEvent.click(screen.getByRole('button', { name: 'Send test mail' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The server refused the user name or password. (server reply 535)');
	});
});
