import { describe, expect, it } from 'vitest';
import { logoutEverywhereConfirm, relativeTime, sessionRows } from './sessionsView';

const now = new Date('2026-11-15T12:00:00Z');

describe('relativeTime', () => {
	it.each([
		['2026-11-15T11:59:40Z', 'just now'],
		['2026-11-15T11:59:00Z', '1 minute ago'],
		['2026-11-15T11:15:00Z', '45 minutes ago'],
		['2026-11-15T11:00:00Z', '1 hour ago'],
		['2026-11-15T03:00:00Z', '9 hours ago'],
		['2026-11-14T12:00:00Z', '1 day ago'],
		['2026-11-08T12:00:00Z', '7 days ago'],
		['2026-09-01T12:00:00Z', '1 September 2026'],
		['2026-11-15T12:00:30Z', 'just now'],
		['not a date', '']
	])('%s -> %s', (iso, want) => expect(relativeTime(iso, now, 'UTC')).toBe(want));
});

describe('sessionRows', () => {
	const list = [
		{ id: 5, device: 'Firefox on Linux', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: '2026-11-15T11:59:50Z', current: true },
		{ id: 3, device: 'qinqin Android · Pixel 8', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-11-14T12:00:00Z', current: false }
	];

	it('labels the current device and hides its revoke button', () => {
		const rows = sessionRows(list, now, 'UTC');
		expect(rows[0]).toMatchObject({ id: 5, current: true, canRevoke: false, deviceLabel: 'Firefox on Linux', badge: 'This device' });
		expect(rows[0].lastActive).toBe('just now');
		expect(rows[1]).toMatchObject({ id: 3, current: false, canRevoke: true, badge: null });
		expect(rows[1].lastActive).toBe('1 day ago');
		expect(rows[1].signedIn).toBe('1 October 2026');
	});

	it('keeps the server order', () => {
		expect(sessionRows(list, now, 'UTC').map((r) => r.id)).toEqual([5, 3]);
	});

	it('offers "others" only when another session exists', () => {
		expect(sessionRows(list.slice(0, 1), now, 'UTC').some((r) => r.canRevoke)).toBe(false);
	});

	it('states the confirmation for logging out everywhere', () => {
		expect(logoutEverywhereConfirm()).toBe(
			'Log out everywhere? Every device, including this one, will need to sign in again.'
		);
	});
});
