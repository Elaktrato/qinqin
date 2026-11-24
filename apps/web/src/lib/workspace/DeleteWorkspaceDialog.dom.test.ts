import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/workspaceContents', () => ({ fetchWorkspaceContents: vi.fn() }));

import { fetchWorkspaceContents } from '$lib/api/workspaceContents';
import { ApiError } from '$lib/api/client';
import type { Workspace } from '$lib/api/types';
import { deferred, escape, pressEnter } from '$lib/ui/testing/dialogForm';
import DeleteWorkspaceDialog from './DeleteWorkspaceDialog.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'delete');
});

const ws = (id: number, name: string): Workspace => ({ id, language: 'zh', name, settings: {}, updatedAt: 't' });
const work = ws(2, 'Work');
const list = [ws(1, ''), work];

function setup() {
	const onclose = vi.fn();
	render(DeleteWorkspaceDialog, { props: { workspace: work, list, onclose }, context: ctx.context });
	const dialog = screen.getByRole('dialog', { name: 'Delete the workspace “Work”?' });
	const typed = screen.getByLabelText('Type Work to confirm') as HTMLInputElement;
	const submit = screen.getByRole('button', { name: 'Delete workspace' }) as HTMLButtonElement;
	const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
	return { dialog, typed, submit, cancel, onclose };
}

beforeEach(() => {
	vi.mocked(fetchWorkspaceContents).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeleteWorkspaceDialog', () => {
	it('starts in the label field and is described by what goes', () => {
		const f = setup();
		expect(document.activeElement).toBe(f.typed);
		expect(screen.getByRole('dialog', { description: /permanently deletes, on every device/ })).toBe(f.dialog);
	});

	it('the submit button is outside the form, tied to it by form=', () => {
		const f = setup();
		const form = f.typed.form!;
		expect(form.contains(f.submit)).toBe(false);
		expect(f.submit.type).toBe('submit');
		expect(f.submit.form).toBe(form);
	});

	it('confirm waits for the label (surrounding spaces ignored, case not); Enter does nothing before', async () => {
		const f = setup();
		expect(f.submit.disabled).toBe(true);
		await fireEvent.input(f.typed, { target: { value: 'work' } });
		expect(f.submit.disabled).toBe(true);
		expect(await pressEnter(f.typed)).toBe(false);
		expect(ctx.session.workspaces.delete).not.toHaveBeenCalled();
		await fireEvent.input(f.typed, { target: { value: '  Work ' } });
		expect(f.submit.disabled).toBe(false);
	});

	it('Enter submits through the button outside the form; success closes with deleted=true', async () => {
		vi.mocked(ctx.session.workspaces.delete).mockResolvedValue();
		const f = setup();
		await fireEvent.input(f.typed, { target: { value: 'Work' } });
		expect(await pressEnter(f.typed)).toBe(true);
		await waitFor(() => expect(f.onclose).toHaveBeenCalledWith(true));
		expect(ctx.session.workspaces.delete).toHaveBeenCalledWith(2);
		expect(f.onclose).toHaveBeenCalledTimes(1);
	});

	it('while deleting it cannot be dismissed and both buttons are disabled', async () => {
		const request = deferred();
		vi.mocked(ctx.session.workspaces.delete).mockReturnValue(request.promise);
		const f = setup();
		await fireEvent.input(f.typed, { target: { value: 'Work' } });
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

	it('the only workspace is refused with a fixed sentence; focus goes back to the field', async () => {
		vi.mocked(ctx.session.workspaces.delete).mockRejectedValue(new ApiError(409, 'conflict'));
		const f = setup();
		await fireEvent.input(f.typed, { target: { value: 'Work' } });
		f.submit.focus();
		await fireEvent.click(f.submit);
		expect((await screen.findByRole('alert')).textContent).toBe('This is your only workspace, so it cannot be deleted.');
		await waitFor(() => expect(document.activeElement).toBe(f.typed));
		expect(f.typed.getAttribute('aria-invalid')).toBe('true');
		expect(f.submit.disabled).toBe(false);
		expect(f.onclose).not.toHaveBeenCalled();
	});

	it('Cancel and Escape close it once with deleted=false', async () => {
		const f = setup();
		await escape(f.dialog);
		await fireEvent.click(f.cancel);
		expect(f.onclose).toHaveBeenCalledTimes(1);
		expect(f.onclose).toHaveBeenCalledWith(false);
	});
});
