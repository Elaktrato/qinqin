import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/adminUsers', () => ({ deletionPreview: vi.fn(), deleteUser: vi.fn() }));

import { deleteUser, deletionPreview } from '$lib/api/adminUsers';
import { ApiError } from '$lib/api/client';
import { auth } from '$lib/auth';
import { deferred, escape, pressEnter } from '$lib/ui/testing/dialogForm';
import DeleteUserDialog from './DeleteUserDialog.svelte';

const refusal = (error: string) => new ApiError(403, JSON.stringify({ error, message: 'server words' }));

function setup(totp = false) {
	auth.set({ token: 't', user: { id: 1, username: 'root', admin: true, mfa: { totp, email: false } } as never });
	const onclose = vi.fn();
	render(DeleteUserDialog, { id: 7, username: 'li', onclose });
	const dialog = screen.getByRole('dialog', { name: 'Delete the account “li”?' });
	const typed = screen.getByLabelText('Type li to confirm') as HTMLInputElement;
	const password = screen.getByLabelText('Your own password') as HTMLInputElement;
	const submit = screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement;
	const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
	return { dialog, typed, password, submit, cancel, onclose };
}

async function fill(f: ReturnType<typeof setup>) {
	await fireEvent.input(f.typed, { target: { value: 'li' } });
	await fireEvent.input(f.password, { target: { value: 'pw' } });
}

beforeEach(() => {
	vi.mocked(deletionPreview).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeleteUserDialog', () => {
	it('starts in the username field and is described by what goes', () => {
		const f = setup();
		expect(document.activeElement).toBe(f.typed);
		expect(screen.getByRole('dialog', { description: /permanently deletes the account/ })).toBe(f.dialog);
	});

	it('the submit button is outside the form, tied to it by form=', () => {
		const f = setup();
		const form = f.typed.form!;
		expect(form.contains(f.submit)).toBe(false);
		expect(f.submit.type).toBe('submit');
		expect(f.submit.form).toBe(form);
		expect(f.password.form).toBe(form);
	});

	it('confirm needs the exact username and the own password (and the code with an authenticator)', async () => {
		const f = setup(true);
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.typed, { target: { value: 'li ' } });
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.typed, { target: { value: 'li' } });
		expect(f.submit.disabled).toBe(true);
		expect(await pressEnter(f.password)).toBe(false);
		expect(deleteUser).not.toHaveBeenCalled();
		await fireEvent.input(screen.getByLabelText('Authenticator or recovery code (yours)'), { target: { value: '654321' } });
		expect(f.submit.disabled).toBe(false);
	});

	it('Enter submits through the button outside the form; success closes with deleted=true', async () => {
		vi.mocked(deleteUser).mockResolvedValue(undefined as never);
		const f = setup();
		await fill(f);
		expect(await pressEnter(f.password)).toBe(true);
		await waitFor(() => expect(f.onclose).toHaveBeenCalledWith(true));
		expect(deleteUser).toHaveBeenCalledWith(7, 'li', { currentPassword: 'pw' });
		expect(f.onclose).toHaveBeenCalledTimes(1);
	});

	it('while deleting it cannot be dismissed and both buttons are disabled', async () => {
		const request = deferred();
		vi.mocked(deleteUser).mockReturnValue(request.promise as never);
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		const busy = (await screen.findByRole('button', { name: 'Deleting…' })) as HTMLButtonElement;
		expect(busy.disabled).toBe(true);
		expect(busy.getAttribute('aria-busy')).toBe('true');
		expect(f.cancel.disabled).toBe(true);
		await escape(f.dialog);
		expect(screen.getByRole('dialog')).toBe(f.dialog);
		expect(f.onclose).not.toHaveBeenCalled();
		request.resolve();
		await waitFor(() => expect(f.onclose).toHaveBeenCalledWith(true));
	});

	it('a wrong password clears the password field and puts focus there', async () => {
		vi.mocked(deleteUser).mockRejectedValue(refusal('wrong_password'));
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('Your password is wrong.');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(f.password.value).toBe('');
		expect(f.typed.value).toBe('li');
		expect(f.onclose).not.toHaveBeenCalled();
	});

	it('password_required puts focus in the password field', async () => {
		vi.mocked(deleteUser).mockRejectedValue(refusal('password_required'));
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('Enter your own password.');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
	});

	it('code_invalid asks for a code even with a stale signed-in user, and focuses it', async () => {
		vi.mocked(deleteUser).mockRejectedValue(refusal('code_invalid'));
		const f = setup(false);
		await fill(f);
		await fireEvent.click(f.submit);
		await screen.findByRole('alert');
		const code = screen.getByLabelText('Authenticator or recovery code (yours)');
		await waitFor(() => expect(document.activeElement).toBe(code));
		expect(f.submit.disabled).toBe(true);
	});

	it('any other failure keeps the dialog open with a fixed sentence and the field focused', async () => {
		vi.mocked(deleteUser).mockRejectedValue(new Error('boom'));
		const f = setup();
		await fill(f);
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('Could not delete the account.');
		await waitFor(() => expect(document.activeElement).toBe(f.typed));
		expect(f.submit.disabled).toBe(false);
	});

	it('Cancel and Escape close it once with deleted=false', async () => {
		const f = setup();
		await escape(f.dialog);
		await fireEvent.click(f.cancel);
		expect(f.onclose).toHaveBeenCalledTimes(1);
		expect(f.onclose).toHaveBeenCalledWith(false);
	});
});
