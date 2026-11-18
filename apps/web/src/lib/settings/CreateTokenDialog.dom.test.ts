import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/tokens', () => ({ createToken: vi.fn() }));

import { createToken } from '$lib/api/tokens';
import { ApiError } from '$lib/api/client';
import { deferred, escape, pressEnter } from '$lib/ui/testing/dialogForm';
import { primaryActions } from '$lib/ui/testing/primary';
import CreateTokenDialog from './CreateTokenDialog.svelte';

const created = { token: 'qq_secret', accessToken: { id: 3 } };

function setup() {
	const oncreated = vi.fn();
	const onclose = vi.fn();
	render(CreateTokenDialog, { workspaces: [{ id: 1, name: 'Work' }], oncreated, onclose });
	const dialog = screen.getByRole('dialog', { name: 'New access token' });
	const name = screen.getByLabelText('Name') as HTMLInputElement;
	const password = screen.getByLabelText('Your password') as HTMLInputElement;
	const submit = screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement;
	const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
	return { dialog, name, password, submit, cancel, oncreated, onclose };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('CreateTokenDialog', () => {
	it('name, password, workspace and expiry are base controls; the token sits in a raised Panel', async () => {
		vi.mocked(createToken).mockResolvedValue(created as never);
		const f = setup();
		expect(screen.getByLabelText('Name').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Your password').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Workspace').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Expires after').closest('.field')).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(1);
		await fireEvent.input(f.name, { target: { value: 'ci' } });
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		const token = await screen.findByLabelText('Your new access token', { selector: 'input' });
		expect(token.closest('.panel.raised')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Copy' }).className).toContain('icon-button');
	});

	it('starts in the name field', () => {
		const f = setup();
		expect(document.activeElement).toBe(f.name);
	});

	it('the submit button is outside the form, tied to it by form=', () => {
		const f = setup();
		const form = f.name.form!;
		expect(form.contains(f.submit)).toBe(false);
		expect(f.submit.type).toBe('submit');
		expect(f.submit.form).toBe(form);
	});

	it('checks the form before sending and focuses the field that is wrong', async () => {
		const f = setup();
		expect(await pressEnter(f.name)).toBe(true);
		expect(screen.getByRole('alert')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(f.name));
		await fireEvent.input(f.name, { target: { value: 'ci' } });
		await pressEnter(f.name);
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(createToken).not.toHaveBeenCalled();
	});

	it('Enter submits; success shows the token once, Done closes and drops it', async () => {
		vi.mocked(createToken).mockResolvedValue(created as never);
		const f = setup();
		await fireEvent.input(f.name, { target: { value: ' ci ' } });
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		expect(await pressEnter(f.password)).toBe(true);
		await screen.findByRole('dialog', { name: 'Your new access token' });
		expect(createToken).toHaveBeenCalledWith({
			name: 'ci',
			scope: 'read',
			workspaceId: null,
			expiresInDays: expect.any(Number),
			currentPassword: 'pw'
		});
		expect(f.oncreated).toHaveBeenCalledWith(created.accessToken);
		expect((screen.getByLabelText('Your new access token', { selector: 'input' }) as HTMLInputElement).value).toBe('qq_secret');
		await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		expect(f.onclose).toHaveBeenCalledTimes(1);
	});

	it('while creating it cannot be dismissed and both buttons are disabled', async () => {
		const request = deferred<typeof created>();
		vi.mocked(createToken).mockReturnValue(request.promise as never);
		const f = setup();
		await fireEvent.input(f.name, { target: { value: 'ci' } });
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		const busy = (await screen.findByRole('button', { name: 'Creating…' })) as HTMLButtonElement;
		expect(busy.disabled).toBe(true);
		expect(busy.getAttribute('aria-busy')).toBe('true');
		expect(f.cancel.disabled).toBe(true);
		await escape(f.dialog);
		expect(screen.getByRole('dialog')).toBe(f.dialog);
		expect(f.onclose).not.toHaveBeenCalled();
		request.resolve(created);
		await screen.findByRole('dialog', { name: 'Your new access token' });
	});

	it('a refusal shows a fixed sentence and puts focus back in the password field', async () => {
		vi.mocked(createToken).mockRejectedValue(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'server words' })));
		const f = setup();
		await fireEvent.input(f.name, { target: { value: 'ci' } });
		await fireEvent.input(f.password, { target: { value: 'pw' } });
		await fireEvent.click(f.submit);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).not.toContain('server words');
		await waitFor(() => expect(document.activeElement).toBe(f.password));
		expect(f.submit.disabled).toBe(false);
		expect(f.oncreated).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog')).toBe(f.dialog);
	});

	it('Cancel and Escape close it once', async () => {
		const f = setup();
		await escape(f.dialog);
		await fireEvent.click(f.cancel);
		expect(f.onclose).toHaveBeenCalledTimes(1);
	});
});
