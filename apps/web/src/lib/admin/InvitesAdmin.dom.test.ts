import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/adminSettings', () => ({
	listInvites: vi.fn(),
	createInvite: vi.fn(),
	revokeInvite: vi.fn(),
	getAuthSettings: vi.fn()
}));

import * as api from '$lib/api/adminSettings';
import { primaryActions } from '$lib/ui/testing/primary';
import InvitesAdmin from './InvitesAdmin.svelte';

const invite = (o: object = {}) => ({
	id: 1, note: 'class', maxUses: 5, uses: 2, expiresAt: null, createdAt: 't',
	createdBy: { id: 1, name: 'a' }, state: 'active', ...o
});

beforeEach(() => {
	vi.mocked(api.listInvites).mockResolvedValue([invite()] as never);
	vi.mocked(api.getAuthSettings).mockResolvedValue({ registration: 'invite' } as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('InvitesAdmin', () => {
	it('has one primary; uses, expiry and note are base controls', async () => {
		render(InvitesAdmin);
		await screen.findByRole('table', { name: 'Invites' });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Create invite link' }).className).toContain('primary');
		expect(screen.getByLabelText('Uses (1 to 100)').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Expires').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Note (optional)').closest('.field')).toBeTruthy();
	});

	it('sends the chosen uses and expiry and shows the link once', async () => {
		vi.mocked(api.createInvite).mockResolvedValue({ invite: invite() as never, token: 'tok', path: '/register#invite=tok' });
		render(InvitesAdmin);
		await screen.findByRole('table', { name: 'Invites' });
		await fireEvent.input(screen.getByLabelText('Uses (1 to 100)'), { target: { value: '3' } });
		await fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '30' } });
		await fireEvent.input(screen.getByLabelText('Note (optional)'), { target: { value: 'friends' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
		await waitFor(() => expect(api.createInvite).toHaveBeenCalledWith({ maxUses: 3, expiresInDays: 30, note: 'friends' }));
		const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
		expect(field.value).toBe(`${location.origin}/register#invite=tok`);
		expect(screen.getByText(/shown once/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(screen.queryByLabelText('Invite link')).toBeNull();
	});

	it('maps No expiry to null', async () => {
		vi.mocked(api.createInvite).mockResolvedValue({ invite: invite() as never, token: 't', path: '/register#invite=t' });
		render(InvitesAdmin);
		await screen.findByRole('table', { name: 'Invites' });
		await fireEvent.change(screen.getByLabelText('Expires'), { target: { value: 'none' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
		await waitFor(() => expect(api.createInvite).toHaveBeenCalledWith({ maxUses: 1, expiresInDays: null, note: '' }));
	});

	it('lists state and uses as text and revokes', async () => {
		vi.mocked(api.revokeInvite).mockResolvedValue(undefined as never);
		render(InvitesAdmin);
		const table = await screen.findByRole('table', { name: 'Invites' });
		expect(within(table).getByText('2 / 5')).toBeTruthy();
		expect(within(table).getByText('Active')).toBeTruthy();
		await fireEvent.click(within(table).getByRole('button', { name: /Revoke/ }));
		await waitFor(() => expect(api.revokeInvite).toHaveBeenCalledWith(1));
	});

	it('says invites do not work while registration is closed', async () => {
		vi.mocked(api.getAuthSettings).mockResolvedValue({ registration: 'closed' } as never);
		render(InvitesAdmin);
		expect(await screen.findByText(/Invites do not work while registration is closed/)).toBeTruthy();
	});
});
