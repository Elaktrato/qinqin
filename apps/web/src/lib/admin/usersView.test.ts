import { describe, expect, it } from 'vitest';
import type { AdminUserDto } from '$lib/api/adminUsers';
import { lastAdminReason, actionNeedsReauth, generateTempPassword, lastSeenLabel, userRows } from './usersView';

const u = (id: number, o: Partial<AdminUserDto> = {}): AdminUserDto => ({
	id,
	username: `user${id}`,
	email: null,
	emailVerified: false,
	admin: false,
	disabled: false,
	mustChangePassword: false,
	createdAt: '2026-01-01T00:00:00Z',
	lastSeenAt: null,
	...o
});
const now = new Date('2026-11-15T12:00:00Z');
const ids = (row: { actions: { id: string }[] }) => row.actions.map((a) => a.id);

describe('userRows', () => {
	it('offers Reset two-step sign-in only for another user who has a second step', () => {
		const rows = userRows(
			[
				u(1, { admin: true, mfa: { totp: true, email: false } }),
				u(2, { mfa: { totp: true, email: false } }),
				u(3, { mfa: { totp: false, email: true } }),
				u(4, { mfa: { totp: false, email: false } }),
				u(5)
			],
			1,
			now
		);
		expect(ids(rows[0])).not.toContain('resetMfa'); // own row: Settings, Account
		expect(rows[1].actions.find((a) => a.id === 'resetMfa')).toEqual({ id: 'resetMfa', label: 'Reset two-step sign-in', disabled: false });
		expect(ids(rows[2])).toContain('resetMfa');
		expect(ids(rows[3])).not.toContain('resetMfa');
		expect(ids(rows[4])).not.toContain('resetMfa');
	});

	it('gives the own row no disable and no delete', () => {
		const rows = userRows([u(1, { admin: true }), u(2, { admin: true })], 1, now);
		expect(ids(rows[0])).not.toContain('disable');
		expect(ids(rows[0])).not.toContain('delete');
		expect(ids(rows[1])).toEqual(expect.arrayContaining(['disable', 'delete', 'removeAdmin']));
		expect(rows[0].self).toBe(true);
	});

	it('disables Remove admin, Disable and Delete for the last active admin, with the reason', () => {
		const rows = userRows([u(1, { admin: true }), u(2, { admin: true, disabled: true }), u(3)], 3, now);
		const last = rows[0];
		for (const id of ['removeAdmin', 'disable', 'delete']) {
			const a = last.actions.find((x) => x.id === id)!;
			expect(a.disabled).toBe(true);
			expect(a.reason).toBe(lastAdminReason());
		}
		// the disabled admin is not counted, and is no last admin
		expect(rows[1].actions.find((x) => x.id === 'removeAdmin')!.disabled).toBe(false);
	});

	it('leaves everything enabled while two admins are active', () => {
		const rows = userRows([u(1, { admin: true }), u(2, { admin: true })], 9, now);
		expect(rows.flatMap((r) => r.actions).every((a) => !a.disabled)).toBe(true);
	});

	it('offers Enable for a disabled user and Make admin for a plain one', () => {
		const rows = userRows([u(1, { admin: true }), u(2, { disabled: true })], 1, now);
		expect(ids(rows[1])).toContain('enable');
		expect(ids(rows[1])).toContain('makeAdmin');
	});

	it('words the status as text', () => {
		const rows = userRows([u(1, { admin: true }), u(2, { disabled: true, mustChangePassword: true })], 1, now);
		expect(rows[0].status).toEqual(['Active']);
		expect(rows[1].status).toEqual(['Disabled', 'Must change password']);
		expect(rows[0].role).toBe('Administrator');
	});
});

describe('userRows: profile pictures (#189)', () => {
	const pic = '/api/avatars/2/0123456789abcdef0123456789abcdef';
	it('carries each user\'s picture and offers Remove profile picture only for one who has one', () => {
		const rows = userRows([u(1, { admin: true, avatarUrl: '/api/avatars/1/aa' }), u(2, { avatarUrl: pic }), u(3, { avatarUrl: null }), u(4)], 1, now);
		expect(rows.map((r) => r.avatarUrl)).toEqual(['/api/avatars/1/aa', pic, null, null]);
		expect(rows[1].actions.find((a) => a.id === 'removePicture')).toEqual({ id: 'removePicture', label: 'Remove profile picture', disabled: false });
		expect(ids(rows[0])).toContain('removePicture'); // an administrator may remove their own here too
		expect(ids(rows[2])).not.toContain('removePicture');
		expect(ids(rows[3])).not.toContain('removePicture');
	});

	it('removes a picture without asking for the password (moderation, audited)', () => {
		expect(actionNeedsReauth('removePicture', { admin: false, self: false })).toBe(false);
		expect(actionNeedsReauth('removePicture', { admin: true, self: false })).toBe(false);
	});
});

describe('lastSeenLabel', () => {
	it('words the age from an injected now', () => {
		expect(lastSeenLabel(null, now)).toBe('Never');
		expect(lastSeenLabel('2026-11-15T11:59:50Z', now)).toBe('Just now');
		expect(lastSeenLabel('2026-11-15T11:55:00Z', now)).toBe('5 minutes ago');
		expect(lastSeenLabel('2026-11-15T09:00:00Z', now)).toBe('3 hours ago');
		expect(lastSeenLabel('2026-11-13T12:00:00Z', now)).toBe('2 days ago');
	});
});

describe('generateTempPassword', () => {
	it('returns 16 characters from the alphabet, no look-alikes', () => {
		const pw = generateTempPassword();
		expect(pw).toHaveLength(16);
		expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
	});
	it('maps bytes with rejection sampling', () => {
		// 255 and 228 are rejected (limit 228 = 4 x 57); 0 -> 'A', 1 -> 'B'
		const bytes = [255, 228, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
		const pw = generateTempPassword(16, (b) => {
			b.set(bytes.slice(0, b.length));
			return b;
		});
		expect(pw).toBe('ABABABABABABABAB');
	});
});

describe('password-gated actions', () => {
	it('names exactly the sensitive ones and offers revoking a pending link', () => {
		const admin = { admin: true, self: false };
		const plain = { admin: false, self: false };
		const own = { admin: true, self: true };
		for (const id of ['makeAdmin', 'resetLink', 'delete'] as const) expect(actionNeedsReauth(id, plain)).toBe(true);
		// taking another administrator out of the way re-authenticates too
		expect(actionNeedsReauth('removeAdmin', admin)).toBe(true);
		expect(actionNeedsReauth('disable', admin)).toBe(true);
		expect(actionNeedsReauth('removeAdmin', own)).toBe(false);
		expect(actionNeedsReauth('disable', plain)).toBe(false);
		for (const id of ['enable', 'requirePasswordChange', 'revokeResetLink', 'signOutEverywhere'] as const) {
			expect(actionNeedsReauth(id, admin)).toBe(false);
		}
		// the two-step reset has its own dialog with the same fields
		expect(actionNeedsReauth('resetMfa', plain)).toBe(false);
		const rows = userRows([u(1, { admin: true }), u(2)], 1, now);
		expect(rows[1].actions.map((a) => a.id)).toContain('revokeResetLink');
	});
});
