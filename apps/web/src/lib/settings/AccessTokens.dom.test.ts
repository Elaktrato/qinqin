import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { ApiError, api } from '$lib/api/client';
import AccessTokens from './AccessTokens.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

// A fake token of the right shape, made at run time (never a real one).
const FAKE = 'qq_pat_' + 'ab'.repeat(32);

const row = (id: number, extra: Record<string, unknown> = {}) => ({
	id,
	name: `token ${id}`,
	hint: 'abcdef',
	scope: 'read',
	workspaceId: null,
	createdAt: '2026-11-01T00:00:00Z',
	expiresAt: '2099-01-01T00:00:00Z',
	lastUsedAt: null,
	expired: false,
	...extra
});

let list: ReturnType<typeof row>[] = [];
let createError: ApiError | null = null;
beforeEach(() => {
	list = [row(2, { scope: 'write', workspaceId: 7 }), row(1)];
	createError = null;
	ctx.session.workspaces.set({ list: [{ id: 7, name: 'Chinese', language: 'zh' } as never], current: null });
	vi.mocked(api).mockImplementation((async (url: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
		if (url === '/api/account/tokens' && !opts?.method) return { accessTokens: list };
		if (url === '/api/account/tokens' && opts?.method === 'POST') {
			if (createError) throw createError;
			const created = row(3, { name: opts.body?.name, scope: opts.body?.scope });
			list = [created, ...list];
			return { token: FAKE, accessToken: created };
		}
		if (url === '/api/account/tokens' && opts?.method === 'DELETE') {
			const n = list.length;
			list = [];
			return { revoked: n };
		}
		if (url.startsWith('/api/account/tokens/') && opts?.method === 'DELETE') {
			const id = Number(url.split('/').pop());
			list = list.filter((t) => t.id !== id);
			return undefined;
		}
		throw new Error(`unexpected ${url}`);
	}) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	localStorage.clear();
});

function apiError(status: number, error: string, message: string): ApiError {
	return new ApiError(status, JSON.stringify({ error, message }));
}

async function openAndFill(name = 'cron sync') {
	await fireEvent.click(screen.getByRole('button', { name: 'New token' }));
	const dialog = await screen.findByRole('dialog');
	await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: name } });
	await fireEvent.input(within(dialog).getByLabelText('Your password'), { target: { value: 'secret-pass-alice' } });
	return dialog;
}

describe('Settings → Account: access tokens', () => {
	it('lists the tokens with their hint, scope, workspace, expiry and last use', async () => {
		render(AccessTokens, { context: ctx.context });
		const table = await screen.findByRole('table', { name: 'Access tokens' });
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('token 2');
		expect(rows[0].textContent).toContain('qq_pat_abcdef…');
		expect(rows[0].textContent).toContain('Read and write');
		expect(rows[0].textContent).toContain('Chinese');
		expect(rows[0].textContent).toContain('Never used');
		expect(rows[1].textContent).toContain('Read only');
		expect(rows[1].textContent).toContain('All workspaces');
	});

	it('creates a token and shows it exactly once, with Copy, the warning and an example', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render(AccessTokens, { context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		const dialog = await openAndFill();
		await fireEvent.click(within(dialog).getByLabelText('Read and write'));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
		const field = (await within(dialog).findByLabelText('Your new access token')) as HTMLInputElement;
		expect(field.value).toBe(FAKE);
		expect(field.readOnly).toBe(true);
		expect(dialog.textContent).toContain('You will not see this token again');
		expect(dialog.textContent).toContain(`curl -sS -H "Authorization: Bearer ${FAKE}"`);
		const call = vi.mocked(api).mock.calls.find(([u, o]) => u === '/api/account/tokens' && (o as { method?: string })?.method === 'POST');
		expect(call?.[1]).toMatchObject({
			body: { name: 'cron sync', scope: 'write', workspaceId: null, expiresInDays: 90, currentPassword: 'secret-pass-alice' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
		expect(writeText).toHaveBeenCalledWith(FAKE);
		await within(dialog).findByText('Copied');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(document.body.innerHTML).not.toContain(FAKE);
		expect(JSON.stringify({ ...localStorage })).not.toContain(FAKE);
		// The list shows the new row; opening again shows an empty form.
		await screen.findByText('cron sync');
		await fireEvent.click(screen.getByRole('button', { name: 'New token' }));
		const again = await screen.findByRole('dialog');
		expect((within(again).getByLabelText('Name') as HTMLInputElement).value).toBe('');
		expect(again.textContent).not.toContain(FAKE);
	});

	it('limits a token to a workspace and picks the expiry', async () => {
		render(AccessTokens, { context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		const dialog = await openAndFill();
		await fireEvent.change(within(dialog).getByLabelText('Workspace'), { target: { value: '7' } });
		await fireEvent.change(within(dialog).getByLabelText('Expires after'), { target: { value: '7' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
		await within(dialog).findByLabelText('Your new access token');
		const call = vi.mocked(api).mock.calls.find(([u, o]) => u === '/api/account/tokens' && (o as { method?: string })?.method === 'POST');
		expect(call?.[1]).toMatchObject({ body: { scope: 'read', workspaceId: 7, expiresInDays: 7 } });
	});

	it.each([
		[apiError(403, 'wrong_password', 'The current password is wrong.'), 'The password is wrong.'],
		[apiError(409, 'token_limit', 'You already have 20 access tokens. Revoke one first.'), 'You already have 20 access tokens. Revoke one first.'],
		[apiError(422, 'invalid_token_request', 'The name must be 1 to 64 characters.'), 'This access token request is not valid.']
	])('shows the server refusal %#', async (err, text) => {
		createError = err;
		render(AccessTokens, { context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		const dialog = await openAndFill();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
		expect((await within(dialog).findByRole('alert')).textContent).toContain(text);
		expect(within(dialog).queryByLabelText('Your new access token')).toBeNull();
	});

	it('checks the form before sending', async () => {
		render(AccessTokens, { context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		const dialog = await openAndFill('   ');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
		expect((await within(dialog).findByRole('alert')).textContent).toContain('The name must be 1 to 64 characters.');
		expect(vi.mocked(api).mock.calls.some(([, o]) => (o as { method?: string })?.method === 'POST')).toBe(false);
	});

	it('revokes one token after a confirmation', async () => {
		render(AccessTokens, { context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		await fireEvent.click(screen.getByRole('button', { name: 'Revoke token 1' }));
		expect(vi.mocked(api).mock.calls.some(([, o]) => (o as { method?: string })?.method === 'DELETE')).toBe(false);
		const confirm = screen.getByRole('group', { name: 'Confirm revoking token 1' });
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, revoke it' }));
		await waitFor(() => expect(screen.queryByText('token 1')).toBeNull());
		expect(vi.mocked(api).mock.calls.some(([u, o]) => u === '/api/account/tokens/1' && (o as { method?: string })?.method === 'DELETE')).toBe(true);
	});

	it('revokes all after a confirmation', async () => {
		const counts: number[] = [];
		render(AccessTokens, { props: { oncount: (n: number) => counts.push(n) }, context: ctx.context });
		await screen.findByRole('table', { name: 'Access tokens' });
		await fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }));
		const confirm = screen.getByRole('group', { name: 'Confirm revoking all access tokens' });
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, revoke all' }));
		await screen.findByText('No access tokens yet.');
		expect(counts.at(0)).toBe(2);
		expect(counts.at(-1)).toBe(0);
	});
});
