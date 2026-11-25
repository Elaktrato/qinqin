// POST /api/reminders/test (#138, #139): one test message now through one channel. The coded errors of the
// contract (docs/contracts/reminders/README.md "Push: routes") become plain messages from the catalogue.

import { api as defaultApi, ApiError } from '../api/client';
import type { MessageKey } from '$lib/i18n';

export type TestChannel = 'email' | 'push';

export type TestResult = { ok: true } | { ok: false; messageKey: MessageKey };

const MESSAGES: Record<string, MessageKey> = {
	email_unverified: 'settings.reminders.test.error.emailUnverified',
	mail_unavailable: 'settings.reminders.test.error.mailUnavailable',
	push_unavailable: 'settings.reminders.test.error.pushUnavailable',
	no_subscription: 'settings.reminders.test.error.noSubscription',
	rate_limited: 'settings.reminders.test.error.rateLimited'
};

/** sendReminderTest asks the server for a test message; never throws. */
export async function sendReminderTest(channel: TestChannel, api: typeof defaultApi = defaultApi): Promise<TestResult> {
	try {
		await api('/api/reminders/test', { method: 'POST', body: { channel } });
		return { ok: true };
	} catch (err) {
		const code = err instanceof ApiError ? err.code : undefined;
		return { ok: false, messageKey: (code !== undefined ? MESSAGES[code] : undefined) ?? 'settings.reminders.test.error.other' };
	}
}
