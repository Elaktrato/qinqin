import { describe, expect, it } from 'vitest';
import type { AdminUserDto } from '$lib/api/adminUsers';
import { LAST_ADMIN_REASON, generateTempPassword, lastSeenLabel, userRows } from './usersView';

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
			expect(a.reason).toBe(LAST_ADMIN_REASON);
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
