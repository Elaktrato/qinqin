import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { ApiError, api } from '$lib/api/client';
import AccountSettings from './AccountSettings.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.app.auth, 'logout').mockImplementation(() => undefined);
	vi.spyOn(ctx.app.auth, 'loadMe').mockResolvedValue(null);
});

const me = (email: string | null = null) => ({
	id: 1, username: 'alice', admin: false, email, emailVerified: false, mustChangePassword: false, createdAt: 't'
});
let policy = 'off';
let deleteError: ApiError | null = null;

beforeEach(() => {
	policy = 'off';
	deleteError = null;
	ctx.app.auth.set({ token: 'tok', user: me() });
	vi.mocked(api).mockImplementation((async (url: string, opts?: { method?: string }) => {
		if (url === '/api/auth/options') return { emailPolicy: policy };
		if (url === '/api/account/sessions') return { sessions: [] };
		if (url === '/api/account/tokens' && !opts?.method) return { accessTokens: [] };
		if (url === '/api/account/email') return { email: 'a@example.org', emailVerified: false };
		if (url === '/api/account/deletion-preview') {
			return { workspaces: 2, studyEvents: 5, pluginData: 0, books: 0, journalPhotos: 0, aiKeys: 0, sessions: 1, overlays: 0, sentences: 0 };
		}
		if (url === '/api/account' && opts?.method === 'DELETE') {
			if (deleteError) throw deleteError;
			return undefined;
		}
		throw new Error(`unexpected ${url}`);
	}) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('Account → profile email', () => {
	it('is hidden while the policy is off', async () => {
		render(AccountSettings, { context: ctx.context });
		await screen.findByText('Profile');
		await waitFor(() => expect(api).toHaveBeenCalledWith('/api/auth/options', expect.anything()));
		expect(screen.queryByLabelText(/^Email/)).toBeNull();
	});

	it('is optional and sends the address with the password under optional', async () => {
		policy = 'optional';
		render(AccountSettings, { context: ctx.context });
		const field = await screen.findByLabelText('Email (optional)');
		await fireEvent.input(field, { target: { value: 'a@example.org' } });
		await fireEvent.input(screen.getAllByLabelText('Your password')[0], { target: { value: 'secret-pass-alice' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save email' }));
		await waitFor(() =>
			expect(api).toHaveBeenCalledWith('/api/account/email', {
				method: 'PUT',
				body: { email: 'a@example.org', currentPassword: 'secret-pass-alice' }
			})
		);
		expect((await screen.findAllByRole('status')).map((n) => n.textContent).join(' ')).toContain('Email address saved.');
	});

	it('cannot be removed under required, shows the banner when missing', async () => {
		policy = 'required';
		render(AccountSettings, { context: ctx.context });
		expect(await screen.findByLabelText('Email')).toBeTruthy();
		expect(screen.getByRole('note').textContent).toContain('asks everyone to add an email address');
		expect(screen.queryByRole('button', { name: 'Remove email' })).toBeNull();
	});
});

describe('Account → delete account', () => {
	async function openDialog() {
		render(AccountSettings, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete my account…' }));
		const dialog = await screen.findByRole('dialog', { hidden: true });
		await waitFor(() => expect(dialog.textContent).toContain('2 workspaces'));
		return dialog;
	}
	const fill = async (pw: string, name: string) => {
		const inputs = screen.getAllByLabelText(/Your password|Type/, { selector: 'dialog input' });
		await fireEvent.input(inputs[0], { target: { value: pw } });
		await fireEvent.input(inputs[1], { target: { value: name } });
	};

	it('needs the password and the typed username, then signs out', async () => {
		await openDialog();
		const del = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement;
		expect(del.disabled).toBe(true);
		await fill('secret-pass-alice', 'alic');
		expect(del.disabled).toBe(true);
		await fill('secret-pass-alice', 'alice');
		expect(del.disabled).toBe(false);
		await fireEvent.click(del);
		await waitFor(() =>
			expect(api).toHaveBeenCalledWith('/api/account', { method: 'DELETE', body: { password: 'secret-pass-alice', confirm: 'alice' } })
		);
		await waitFor(() => expect(ctx.app.auth.logout).toHaveBeenCalled());
	});

	it('says what to do first when the server answers last_admin', async () => {
		deleteError = new ApiError(409, JSON.stringify({ error: 'last_admin', message: 'x' }));
		await openDialog();
		await fill('secret-pass-alice', 'alice');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
		expect((await screen.findByRole('alert')).textContent).toContain('last administrator');
		expect(ctx.app.auth.logout).not.toHaveBeenCalled();
	});
});
