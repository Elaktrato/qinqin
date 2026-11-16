import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

const me = await vi.hoisted(async () => {
	const { writable } = await import('svelte/store');
	return writable<unknown>({ username: 'owner', mfa: { totp: false } });
});
vi.mock('$lib/auth', () => ({ user: me }));
vi.mock('$lib/api/backup', () => ({ createServerBackup: vi.fn() }));
import * as api from '$lib/api/backup';
import ServerBackup from './ServerBackup.svelte';

afterEach(() => { cleanup(); vi.clearAllMocks(); me.set({ username: 'owner', mfa: { totp: false } }); });

async function fill(): Promise<HTMLButtonElement> {
	await fireEvent.input(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
	return screen.getByRole('button', { name: 'Create server backup' }) as HTMLButtonElement;
}

describe('ServerBackup', () => {
	it('sends the chosen parts and password, then navigates to the ticket URL', async () => {
		vi.mocked(api.createServerBackup).mockResolvedValue({ url: '/api/admin/backup/t', expiresInSeconds: 60, include: [] });
		const assign = vi.fn();
		render(ServerBackup, { assign });
		await fireEvent.click(screen.getByLabelText(/Audio/));
		const btn = await fill();
		await fireEvent.click(btn);
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/admin/backup/t'));
		expect(api.createServerBackup).toHaveBeenCalledWith({ currentPassword: 'pw', code: undefined, include: ['db', 'books', 'packs'] });
	});
	it('shows the free-space sentence on 507 and the running sentence on 409', async () => {
		render(ServerBackup, { assign: vi.fn() });
		const btn = await fill();
		vi.mocked(api.createServerBackup).mockRejectedValueOnce(new ApiError(507, JSON.stringify({ error: 'insufficient_storage', message: 'x' })));
		await fireEvent.click(btn);
		expect((await screen.findByRole('alert')).textContent).toContain('free space');
		vi.mocked(api.createServerBackup).mockRejectedValueOnce(new ApiError(409, JSON.stringify({ error: 'backup_running', message: 'x' })));
		await fireEvent.click(btn);
		await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A backup is already running.'));
	});
	it('is disabled without a part or a password and lists the restore steps', async () => {
		render(ServerBackup);
		expect((screen.getByRole('button', { name: 'Create server backup' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/Stop the container/)).toBeTruthy();
	});
	it('asks for the authenticator code of an administrator who has one', async () => {
		me.set({ username: 'owner', mfa: { totp: true } });
		vi.mocked(api.createServerBackup).mockResolvedValue({ url: '/u', expiresInSeconds: 60, include: [] });
		render(ServerBackup, { assign: vi.fn() });
		const btn = await fill();
		expect(btn.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText(/Authenticator or recovery code/), { target: { value: '123456' } });
		expect(btn.disabled).toBe(false);
		await fireEvent.click(btn);
		await waitFor(() => expect(api.createServerBackup).toHaveBeenCalledWith({ currentPassword: 'pw', code: '123456', include: ['db', 'books', 'packs', 'audio'] }));
	});
});

describe('ServerBackup: a stale copy of the signed-in administrator', () => {
	it('shows the code field once the server asks for a code', async () => {
		render(ServerBackup, { assign: vi.fn() });
		const btn = await fill();
		expect(screen.queryByLabelText(/Authenticator or recovery code/)).toBeNull();
		vi.mocked(api.createServerBackup).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'code_invalid', message: 'x' })));
		await fireEvent.click(btn);
		const code = (await screen.findByLabelText(/Authenticator or recovery code/)) as HTMLInputElement;
		expect(code.getAttribute('spellcheck')).toBe('false');
		await waitFor(() => expect(document.activeElement).toBe(code));
	});
});
