import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/account', () => ({ accountDeletionPreview: vi.fn(), deleteAccount: vi.fn() }));
vi.mock('$lib/api/backup', () => ({ downloadMyData: vi.fn() }));

import { accountDeletionPreview, deleteAccount } from '$lib/api/account';
import { ApiError } from '$lib/api/client';
import { auth } from '$lib/auth';
import { deferred, escape, pressEnter } from '$lib/ui/testing/dialogForm';
import DeleteAccountDialog from './DeleteAccountDialog.svelte';

const refusal = (error: string) => new ApiError(409, JSON.stringify({ error, message: 'server words' }));

function setup(totp = false) {
	auth.set({ token: 't', user: { id: 1, username: 'mei', mfa: { totp, email: false } } as never });
	const ondone = vi.fn();
	const onclose = vi.fn();
	render(DeleteAccountDialog, { username: 'mei', ondone, onclose });
	const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
	const password = screen.getByLabelText('Your password') as HTMLInputElement;
	const typed = screen.getByLabelText('Type mei to confirm') as HTMLInputElement;
	const submit = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement;
	const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
	return { dialog, password, typed, submit, cancel, ondone, onclose };
}

async function fill(f: ReturnType<typeof setup>) {
	await fireEvent.input(f.password, { target: { value: 'secret' } });
	await fireEvent.input(f.typed, { target: { value: 'mei' } });
}

beforeEach(() => {
	vi.mocked(accountDeletionPreview).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeleteAccountDialog', () => {
	it('password and confirmation are Field underlines; the confirm is a danger primary', () => {
		const f = setup();
		expect(f.password.closest('.field')).toBeTruthy();
		expect(f.typed.closest('.field')).toBeTruthy();
		expect(f.submit.className).toContain('danger');
		expect(f.submit.className).toContain('primary');
	});

	it('starts in the password field, described by what goes', () => {
		const f = setup();
		expect(document.activeElement).toBe(f.password);
		expect(f.dialog.getAttribute('aria-describedby')).toBeTruthy();
		expect(screen.getByRole('dialog', { description: /permanently deletes your account/ })).toBe(f.dialog);
	});

	it('the submit button sits in the actions row, outside the form, tied to it by form=', () => {
		const f = setup();
		const form = f.password.form!;
		expect(form).toBeTruthy();
		expect(form.contains(f.submit)).toBe(false);
		expect(f.submit.type).toBe('submit');
		expect(f.submit.form).toBe(form);
	});

	it('confirm stays disabled until the password and the exact username are in; Enter does nothing before', async () => {
		const f = setup();
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.password, { target: { value: 'secret' } });
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.typed, { target: { value: 'Mei' } });
		expect(f.submit.disabled).toBe(true);
		expect(await pressEnter(f.typed)).toBe(false);
		expect(deleteAccount).not.toHaveBeenCalled();
		await fireEvent.input(f.typed, { target: { value: 'mei' } });
		expect(f.submit.disabled).toBe(false);
	});

	it('asks for the code too when the account has an authenticator, and sends it trimmed', async () => {
		vi.mocked(deleteAccount).mockResolvedValue();
		const f = setup(true);
		await fill(f);
		const code = screen.getByLabelText('Code from your authenticator app (or a recovery code)');
		await fireEvent.input(code, { target: { value: ' 123456 ' } });
		await pressEnter(f.typed);
		await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('secret', 'mei', '123456'));
	});

	it('Enter in a field submits (implicit submission through the button outside the form); success calls ondone only', async () => {
		vi.mocked(deleteAccount).mockResolvedValue();
		const f = setup();
		await fill(f);
		expect(await pressEnter(f.password)).toBe(true);
		await waitFor(() => expect(f.ondone).toHaveBeenCalledTimes(1));
		expect(deleteAccount).toHaveBeenCalledWith('secret', 'mei', undefined);
		expect(f.onclose).not.toHaveBeenCalled();
	});

	it('while deleting: busy label, both buttons disabled, Escape and cancel do not close it', async () => {
		const request = deferred();
		vi.mocked(deleteAccount).mockReturnValue(request.promise);
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Deleting…' })).toBeTruthy());
		const busyButton = screen.getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement;
		expect(busyButton.disabled).toBe(true);
		expect(busyButton.getAttribute('aria-busy')).toBe('true');
		expect(f.cancel.disabled).toBe(true);
		await escape(f.dialog);
		expect(screen.getByRole('dialog')).toBe(f.dialog);
		expect(f.onclose).not.toHaveBeenCalled();
		request.resolve();
		await waitFor(() => expect(f.ondone).toHaveBeenCalledTimes(1));
	});

	it('a refusal shows the sentence, keeps the dialog, and puts focus back in the password field', async () => {
		vi.mocked(deleteAccount).mockRejectedValue(refusal('wrong_password'));
		const f = setup();
		await fill(f);
		f.submit.focus();
		await fireEvent.click(f.submit);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).not.toContain('server words');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(f.submit.disabled).toBe(false);
		expect(f.ondone).not.toHaveBeenCalled();
		expect(f.onclose).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog')).toBe(f.dialog);
	});

	it('the last administrator is told what to do first', async () => {
		vi.mocked(deleteAccount).mockRejectedValue(refusal('last_admin'));
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe(
			'You are the last administrator. Make someone else an administrator first.'
		);
	});

	it('Cancel and Escape close it once when idle', async () => {
		const f = setup();
		await escape(f.dialog);
		await fireEvent.click(f.cancel);
		expect(f.onclose).toHaveBeenCalledTimes(1);
	});
});
