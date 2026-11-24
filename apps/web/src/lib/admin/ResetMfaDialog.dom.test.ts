import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/adminUsers', () => ({ resetUserMfa: vi.fn() }));

import { resetUserMfa } from '$lib/api/adminUsers';
import { ApiError } from '$lib/api/client';
import { deferred, escape, pressEnter } from '$lib/ui/testing/dialogForm';
import ResetMfaDialog from './ResetMfaDialog.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const refusal = (error: string) => new ApiError(403, JSON.stringify({ error, message: 'server words' }));

function setup(totp = false) {
	ctx.app.auth.set({ token: 't', user: { id: 1, username: 'root', admin: true, mfa: { totp, email: false } } as never });
	const onclose = vi.fn();
	const ongone = vi.fn();
	render(ResetMfaDialog, { props: { id: 7, username: 'li', mfa: { totp: true, email: true }, onclose, ongone }, context: ctx.context });
	const dialog = screen.getByRole('dialog', { name: 'Reset two-step sign-in for “li”?' });
	const password = screen.getByLabelText('Your own password') as HTMLInputElement;
	const submit = screen.getByRole('button', { name: 'Reset two-step sign-in' }) as HTMLButtonElement;
	const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
	return { dialog, password, submit, cancel, onclose, ongone };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('ResetMfaDialog', () => {
	it('starts in the password field and is described by what goes', () => {
		const f = setup();
		expect(document.activeElement).toBe(f.password);
		expect(screen.getByRole('dialog', { description: /authenticator app and all of its recovery codes/ })).toBe(f.dialog);
	});

	it('the submit button is outside the form, tied to it by form=', () => {
		const f = setup();
		const form = f.password.form!;
		expect(form.contains(f.submit)).toBe(false);
		expect(f.submit.type).toBe('submit');
		expect(f.submit.form).toBe(form);
	});

	it('confirm needs the password, and the code when the administrator has an authenticator', async () => {
		const f = setup(true);
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		expect(f.submit.disabled).toBe(true);
		expect(await pressEnter(f.password)).toBe(false);
		const code = screen.getByLabelText('Authenticator or recovery code (yours)');
		await fireEvent.input(code, { target: { value: '   ' } });
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(code, { target: { value: '111222' } });
		expect(f.submit.disabled).toBe(false);
		expect(resetUserMfa).not.toHaveBeenCalled();
	});

	it('Enter submits through the button outside the form; success closes with reset=true', async () => {
		vi.mocked(resetUserMfa).mockResolvedValue(undefined as never);
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		expect(await pressEnter(f.password)).toBe(true);
		await waitFor(() => expect(f.onclose).toHaveBeenCalledWith(true));
		expect(resetUserMfa).toHaveBeenCalledWith(7, { currentPassword: 'pw' });
	});

	it('while resetting it cannot be dismissed and both buttons are disabled', async () => {
		const request = deferred();
		vi.mocked(resetUserMfa).mockReturnValue(request.promise as never);
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		await waitFor(() => expect(f.submit.disabled).toBe(true));
		expect(f.submit.getAttribute('aria-busy')).toBe('true');
		expect(f.cancel.disabled).toBe(true);
		await escape(f.dialog);
		expect(screen.getByRole('dialog')).toBe(f.dialog);
		expect(f.onclose).not.toHaveBeenCalled();
		request.resolve();
		await waitFor(() => expect(f.onclose).toHaveBeenCalledWith(true));
	});

	it('a wrong password clears and focuses the password field; the dialog stays', async () => {
		vi.mocked(resetUserMfa).mockRejectedValue(refusal('wrong_password'));
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('Your password is wrong.');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(f.password.value).toBe('');
		expect(f.onclose).not.toHaveBeenCalled();
	});

	it('an unknown failure keeps the password and focuses its field', async () => {
		vi.mocked(resetUserMfa).mockRejectedValue(new Error('boom'));
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		f.submit.focus();
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('Could not reset the two-step sign-in. Try again.');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(f.password.value).toBe('pw');
		expect(f.submit.disabled).toBe(false);
	});

	it('a code refusal focuses the code field', async () => {
		vi.mocked(resetUserMfa).mockRejectedValue(refusal('code_invalid'));
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		await screen.findByRole('alert');
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Authenticator or recovery code (yours)')));
	});

	it('a gone account tells the list to reload', async () => {
		vi.mocked(resetUserMfa).mockRejectedValue(new ApiError(404, JSON.stringify({ error: 'not_found', message: '' })));
		const f = setup();
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('This account does not exist any more.');
		expect(f.ongone).toHaveBeenCalledTimes(1);
	});

	it('Cancel and Escape close it once with reset=false', async () => {
		const f = setup();
		await escape(f.dialog);
		await fireEvent.click(f.cancel);
		expect(f.onclose).toHaveBeenCalledTimes(1);
		expect(f.onclose).toHaveBeenCalledWith(false);
	});
});
