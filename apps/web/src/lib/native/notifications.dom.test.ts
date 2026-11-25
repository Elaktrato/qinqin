import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelAllNotifications,
	cancelNotification,
	notificationPermission,
	notificationsAvailable,
	pendingNotifications,
	requestNotificationPermission,
	scheduleNotification
} from './notifications';

const win = window as unknown as { Capacitor?: unknown };
afterEach(() => {
	delete win.Capacitor;
	vi.useRealTimers();
});

const channel = { id: 'reminders', name: 'Study reminders' };

describe('notifications in a normal browser', () => {
	it('are unsupported and every call does nothing', async () => {
		expect(notificationsAvailable()).toBe(false);
		expect(await notificationPermission()).toBe('unsupported');
		expect(await requestNotificationPermission()).toBe('unsupported');
		expect(await scheduleNotification({ id: 1, title: 't', at: Date.now() + 60_000, channel })).toBe(false);
		await expect(cancelNotification(1)).resolves.toBeUndefined();
		await expect(cancelAllNotifications()).resolves.toBeUndefined();
		expect(await pendingNotifications()).toEqual([]);
	});
});

describe('notifications in the shell', () => {
	const fake = () => {
		const q = {
			permission: vi.fn(async () => ({ state: 'prompt' })),
			requestPermission: vi.fn(async () => ({ state: 'granted' })),
			schedule: vi.fn(async () => undefined),
			cancel: vi.fn(async () => undefined),
			cancelAll: vi.fn(async () => undefined),
			pending: vi.fn(async () => ({ ids: [3, 4] }))
		};
		win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinNotifications: q } };
		return q;
	};

	it('reports and asks for the permission', async () => {
		const q = fake();
		expect(notificationsAvailable()).toBe(true);
		expect(await notificationPermission()).toBe('prompt');
		expect(await requestNotificationPermission()).toBe('granted');
		expect(q.requestPermission).toHaveBeenCalled();
	});

	it('schedules with epoch milliseconds, the channel and a validated route', async () => {
		const q = fake();
		const at = new Date(Date.now() + 3600_000);
		expect(await scheduleNotification({ id: 7, title: 'Study', body: '12 due', at, channel, route: '/study' })).toBe(true);
		expect(q.schedule).toHaveBeenCalledWith({ id: 7, title: 'Study', body: '12 due', at: at.getTime(), channel, route: '/study' });
	});

	it('refuses what the shell would refuse, without calling it', async () => {
		const q = fake();
		const soon = Date.now() + 60_000;
		expect(await scheduleNotification({ id: -1, title: 't', at: soon, channel })).toBe(false);
		expect(await scheduleNotification({ id: 1, title: ' ', at: soon, channel })).toBe(false);
		expect(await scheduleNotification({ id: 1, title: 't', at: Date.now() - 1000, channel })).toBe(false);
		expect(await scheduleNotification({ id: 1, title: 't', at: soon, channel, route: 'https://evil.example' })).toBe(false);
		expect(await scheduleNotification({ id: 1, title: 't', at: soon, channel: { id: 'bad id!', name: 'x' } })).toBe(false);
		expect(q.schedule).not.toHaveBeenCalled();
	});

	it('a rejection from the shell is false', async () => {
		const q = fake();
		q.schedule.mockRejectedValue(new Error('not a valid notification'));
		expect(await scheduleNotification({ id: 1, title: 't', at: Date.now() + 60_000, channel })).toBe(false);
	});

	it('cancels one or all and lists the pending ids', async () => {
		const q = fake();
		await cancelNotification(3);
		await cancelAllNotifications();
		expect(q.cancel).toHaveBeenCalledWith({ id: 3 });
		expect(q.cancelAll).toHaveBeenCalled();
		expect(await pendingNotifications()).toEqual([3, 4]);
	});
});
