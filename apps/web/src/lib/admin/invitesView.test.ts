import { describe, expect, it } from 'vitest';
import type { InviteDto } from '$lib/api/adminSettings';
import { EXPIRY_CHOICES, inviteLink, invitePayload, inviteRows, stateLabel } from './invitesView';

describe('invites view', () => {
	it('offers 1, 7, 30, 90 days and no expiry', () => {
		expect(EXPIRY_CHOICES.map((c) => c.days)).toEqual([1, 7, 30, 90, null]);
	});
	it('builds the payload and clamps the uses', () => {
		expect(invitePayload(3, 7, '  class  ')).toEqual({ maxUses: 3, expiresInDays: 7, note: 'class' });
		expect(invitePayload(0, null, '')).toEqual({ maxUses: 1, expiresInDays: null, note: '' });
		expect(invitePayload(500, 30, '')).toMatchObject({ maxUses: 100 });
		expect(invitePayload(Number.NaN, 1, '')).toMatchObject({ maxUses: 1 });
	});
	it('words every state as text', () => {
		expect(stateLabel('active')).toBe('Active');
		expect(stateLabel('used_up')).toBe('Used up');
		expect(stateLabel('inactive')).toBe('Inactive while registration is closed');
	});
	it('rows show uses and let anything not revoked be revoked', () => {
		const i = (o: Partial<InviteDto>): InviteDto => ({
			id: 1, note: '', maxUses: 5, uses: 2, expiresAt: null, createdAt: 't', createdBy: { id: 1, name: 'a' }, state: 'active', ...o
		});
		const rows = inviteRows([i({}), i({ id: 2, state: 'revoked', note: 'x' })]);
		expect(rows[0]).toMatchObject({ uses: '2 / 5', expires: 'Never', canRevoke: true, note: 'No note' });
		expect(rows[1].canRevoke).toBe(false);
	});
	it('builds the link from the origin and the fragment path', () => {
		expect(inviteLink('https://q.example', '/register#invite=abc')).toBe('https://q.example/register#invite=abc');
	});
});
