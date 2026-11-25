// The root layout keys its page tree on the session (record 0009): a reload of
// `me` for the same user keeps the session, so the page keeps what it shows.
// Regenerated recovery codes are shown once; a remount would lose them while
// the old ones are already invalid.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()), afterNavigate: vi.fn() }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn(() => Promise.resolve([]))
}));

import { api } from '$lib/api/client';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { contextOf } from '$lib/context/context';
import { fakeDeps } from '$lib/testing/context';
import { setUrl } from '$lib/testing/appState.svelte';
import Harness from '$lib/testing/LayoutWithTwoFactor.svelte';

let app: AppContext;

afterEach(() => {
	cleanup();
	app?.dispose();
	vi.clearAllMocks();
	localStorage.clear();
});

const me = {
	id: 1,
	username: 'u',
	admin: false,
	email: null,
	emailVerified: false,
	mustChangePassword: false,
	createdAt: '2026-01-01T00:00:00Z',
	mfa: { totp: true, email: false, recoveryCodesLeft: 10 }
};

describe('the layout keeps the page across a reload of `me`', () => {
	it('regenerated recovery codes stay on screen after loadMe', async () => {
		setUrl('/settings');
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return me;
			if (url === '/api/account/mfa/recovery-codes') return { recoveryCodes: ['code-one-1111', 'code-two-2222'] };
			return [];
		}) as never);
		app = createAppContext(fakeDeps(undefined, { local: () => localStorage, window }));
		const { findByRole, findByText, findByLabelText } = render(Harness, { context: contextOf(app) });
		const session = await waitFor(() => {
			expect(app.session?.user).toBe(1);
			return app.session;
		});
		await fireEvent.click(await findByRole('button', { name: 'New recovery codes' }));
		await fireEvent.input(await findByLabelText('Your password'), { target: { value: 'pw' } });
		await fireEvent.input(await findByLabelText('Code from your app, or a recovery code'), { target: { value: '123456' } });
		await fireEvent.click(await findByRole('button', { name: 'Make new recovery codes' }));
		// The component reloads `me` after the change; the codes must still be shown.
		await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([u]) => u === '/api/auth/me').length).toBeGreaterThanOrEqual(2));
		await new Promise((r) => setTimeout(r, 20));
		expect(app.session).toBe(session);
		expect(await findByText(/code-one-1111/)).toBeTruthy();
	});
});
