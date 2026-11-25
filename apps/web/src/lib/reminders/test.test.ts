import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { sendReminderTest } from './test';

const fail = (status: number, error: string) => vi.fn(async () => { throw new ApiError(status, JSON.stringify({ error, message: 'x' })); }) as never;

describe('sendReminderTest', () => {
	it('POSTs the channel and is ok on 204', async () => {
		const api = vi.fn(async () => undefined) as never;
		expect(await sendReminderTest('email', api)).toEqual({ ok: true });
		expect(api).toHaveBeenCalledWith('/api/reminders/test', { method: 'POST', body: { channel: 'email' } });
	});
	it.each([
		[409, 'email_unverified', 'settings.reminders.test.error.emailUnverified'],
		[409, 'mail_unavailable', 'settings.reminders.test.error.mailUnavailable'],
		[409, 'push_unavailable', 'apiError.pushUnavailable'],
		[409, 'no_subscription', 'apiError.noSubscription'],
		[502, 'delivery_failed', 'apiError.deliveryFailed'],
		[429, 'rate_limited', 'settings.reminders.test.error.rateLimited'],
		[500, 'internal', 'settings.reminders.test.error.other']
	])('%i %s is a plain message', async (status, code, key) => {
		expect(await sendReminderTest('push', fail(status, code))).toEqual({ ok: false, messageKey: key });
	});
	it('an unreachable server is the generic message', async () => {
		expect(await sendReminderTest('push', vi.fn(async () => { throw new TypeError('offline'); }) as never)).toEqual({
			ok: false,
			messageKey: 'settings.reminders.test.error.other'
		});
	});
});
