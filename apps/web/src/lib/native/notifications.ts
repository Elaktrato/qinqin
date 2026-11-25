// Local notifications: the API the reminders (#137-#139) build on. Permission (Android 13), schedule and cancel
// by id with a title, a body, a time, a channel and an in-app route a tap opens. Implemented by the shell's own
// plugin (AlarmManager + NotificationCompat, no Google services); nothing happens in a browser.
// Android may deliver a scheduled notification minutes late (inexact alarms, plan 2026-11-25-native-features).
import { routeHref } from './incoming';
import { plugin } from './shell';

export interface NotificationsPlugin {
	permission(): Promise<{ state: string }>;
	requestPermission(): Promise<{ state: string }>;
	schedule(options: {
		id: number;
		title: string;
		body?: string;
		at: number;
		channel: { id: string; name: string };
		route?: string;
	}): Promise<void>;
	cancel(options: { id: number }): Promise<void>;
	cancelAll(): Promise<void>;
	pending(): Promise<{ ids: number[] }>;
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface LocalNotification {
	/** A non-negative integer you choose; scheduling the same id again replaces the earlier one. */
	id: number;
	title: string;
	body?: string;
	/** When to show it (a future time). */
	at: Date | number;
	/** The Android channel (the person can mute it in system settings): a short id and a name in the interface language. */
	channel: { id: string; name: string };
	/** An in-app path a tap opens (`/study`). */
	route?: string;
}

const shell = (): NotificationsPlugin | null => plugin<NotificationsPlugin>('QinqinNotifications');

/** notificationsAvailable: whether this device can show local notifications from the app (the Android shell). */
export function notificationsAvailable(): boolean {
	return shell() !== null;
}

function asState(s: string): NotificationPermission {
	return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'denied';
}

export async function notificationPermission(): Promise<NotificationPermission> {
	const s = shell();
	if (s === null) return 'unsupported';
	try {
		return asState((await s.permission()).state);
	} catch {
		return 'unsupported';
	}
}

/** requestNotificationPermission shows Android's permission dialog (once; later it only reports). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	const s = shell();
	if (s === null) return 'unsupported';
	try {
		return asState((await s.requestPermission()).state);
	} catch {
		return 'unsupported';
	}
}

/** scheduleNotification schedules one; false when it was refused (invalid, in the past, no shell). */
export async function scheduleNotification(n: LocalNotification): Promise<boolean> {
	const s = shell();
	if (s === null) return false;
	const at = n.at instanceof Date ? n.at.getTime() : n.at;
	const route = n.route === undefined ? undefined : routeHref(n.route);
	if (
		!Number.isSafeInteger(n.id) || n.id < 0 || n.id > 2147483647 ||
		n.title.trim() === '' ||
		!Number.isFinite(at) || at <= Date.now() ||
		!/^[A-Za-z0-9_.-]{1,40}$/.test(n.channel.id) ||
		route === null
	) {
		return false;
	}
	try {
		await s.schedule({ id: n.id, title: n.title, ...(n.body ? { body: n.body } : {}), at, channel: n.channel, ...(route ? { route } : {}) });
		return true;
	} catch {
		return false;
	}
}

export async function cancelNotification(id: number): Promise<void> {
	await Promise.resolve(shell()?.cancel({ id })).catch(() => undefined);
}

export async function cancelAllNotifications(): Promise<void> {
	await Promise.resolve(shell()?.cancelAll()).catch(() => undefined);
}

/** pendingNotifications: the ids scheduled and not yet shown. */
export async function pendingNotifications(): Promise<number[]> {
	try {
		return (await shell()?.pending())?.ids ?? [];
	} catch {
		return [];
	}
}
