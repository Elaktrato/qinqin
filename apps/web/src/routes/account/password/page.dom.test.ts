import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn(async () => ({}))
}));

import { api } from '$lib/api/client';
import { testContext, type TestContext } from '$lib/testing/context';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext({ user: { id: 1, username: 'bobby', needsCurrentPassword: true } });
	vi.spyOn(ctx.app.auth, 'loadMe').mockResolvedValue(null);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('the forced password change in the lighter look (#106)', () => {
	it('has one primary action, "Change password", and Field underlines', async () => {
		render(Page, { context: ctx.context });
		const submit = screen.getByRole('button', { name: 'Change password' });
		expect(primaryActions(document.body)).toEqual([submit]);
		for (const label of ['Current password', 'New password', 'Repeat the new password']) {
			expect(screen.getByLabelText(label).closest('.field')).not.toBeNull();
		}
	});

	it('saves the new password with the current one', async () => {
		render(Page, { context: ctx.context });
		await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'old-password-1' } });
		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'brand-new-password' } });
		await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'brand-new-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
		await waitFor(() =>
			expect(api).toHaveBeenCalledWith('/api/account/password', {
				method: 'POST',
				body: { newPassword: 'brand-new-password', signOutOthers: true, currentPassword: 'old-password-1' }
			})
		);
		expect(goto).toHaveBeenCalledWith('/', { replaceState: true });
	});
});
