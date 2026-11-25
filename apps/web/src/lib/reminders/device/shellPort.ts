// The Android shell's notification module as the reminders' device port (#137, #36): the one adapter between
// lib/native/notifications (one notification at a time) and the scheduler's batch interface.
import { t } from '$lib/i18n';
import {
	cancelAllNotifications,
	notificationPermission,
	requestNotificationPermission,
	scheduleNotification
} from '$lib/native/notifications';
import type { DevicePort } from './port';

const CHANNEL_ID = 'reminders';

export const shellPort: DevicePort = {
	permissionStatus: () => notificationPermission(),
	requestPermission: () => requestNotificationPermission(),
	async schedule(items) {
		const channel = { id: CHANNEL_ID, name: t('settings.reminders.channels.device.label') };
		for (const n of items) await scheduleNotification({ ...n, channel });
	},
	cancelAll: () => cancelAllNotifications()
};
