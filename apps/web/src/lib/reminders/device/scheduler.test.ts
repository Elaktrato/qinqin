import { describe, expect, it, vi } from 'vitest';
import { manualTimers } from '$lib/testing/context';
import { t as translate } from '$lib/i18n';
import type { ReminderPlan } from '../plan';
import { defaultReminderSettings, type ReminderSettings } from '../settings';
import { fakePort } from './port';
import { createDeviceScheduler } from './scheduler';

const NOW = Date.parse('2026-11-25T10:00:00Z');

function plan(slots: ReminderPlan['slots']): ReminderPlan {
	return { generatedAt: '', zone: 'UTC', enabled: true, channels: { email: false, push: false, device: true }, available: { email: false, push: true }, slots };
}
const slot = (id: number, kind: 'due' | 'goal' | 'streak', at: string, count: number | null) => ({ id, kind, at, local: '', day: '', count });

function on(): ReminderSettings {
	return { ...defaultReminderSettings(), enabled: true, channels: { email: false, push: false, device: true } };
}

function setup(over: { settings?: ReminderSettings; permission?: 'granted' | 'denied' | 'prompt' | 'unsupported'; shell?: boolean; slots?: ReminderPlan['slots'] } = {}) {
	const port = fakePort(over.permission ?? 'granted');
	const settings = { value: over.settings ?? on() };
	const fetchPlan = vi.fn(async (_days: number) => plan(over.slots ?? [slot(1, 'due', '2026-11-25T17:00:00Z', 15), slot(2, 'goal', '2026-11-25T18:00:00Z', null), slot(3, 'streak', '2026-11-25T08:00:00Z', 4)]));
	const timers = manualTimers();
	const scheduler = createDeviceScheduler({
		port,
		fetchPlan,
		settings: async () => settings.value,
		now: () => NOW,
		translate,
		isShell: () => over.shell ?? true,
		timers
	});
	return { port, settings, fetchPlan, timers, scheduler };
}

describe('replan', () => {
	it('cancels, then schedules every future slot with catalogue text and the study route', async () => {
		const { port, fetchPlan, scheduler } = setup();
		await scheduler.replan();
		expect(fetchPlan).toHaveBeenCalledWith(7);
		expect(port.calls).toEqual(['permissionStatus', 'cancelAll', 'schedule:2']);
		expect(port.scheduled).toEqual([
			{ id: 1, title: 'Time to study', body: '15 cards are due.', at: new Date('2026-11-25T17:00:00Z'), route: '/study' },
			{ id: 2, title: 'Your daily goal', body: "Today's goal is still open.", at: new Date('2026-11-25T18:00:00Z'), route: '/study' }
		]);
	});
	it('uses the singular for one card', async () => {
		const { port, scheduler } = setup({ slots: [slot(1, 'due', '2026-11-25T17:00:00Z', 1)] });
		await scheduler.replan();
		expect(port.scheduled[0].body).toBe('1 card is due.');
	});
	it('does nothing outside the shell', async () => {
		const { port, fetchPlan, scheduler } = setup({ shell: false });
		await scheduler.replan();
		expect(port.calls).toEqual([]);
		expect(fetchPlan).not.toHaveBeenCalled();
	});
	it.each([
		['reminders off', { ...on(), enabled: false }],
		['the device channel off', { ...on(), channels: { email: true, push: true, device: false } }]
	])('cancels what was scheduled when %s, and fetches nothing', async (_n, settings) => {
		const { port, fetchPlan, scheduler } = setup({ settings });
		await port.schedule([{ id: 9, title: 'old', body: 'old', at: new Date(NOW + 1000) }]);
		port.calls.length = 0;
		await scheduler.replan();
		expect(port.scheduled).toEqual([]);
		expect(fetchPlan).not.toHaveBeenCalled();
	});
	it.each(['denied', 'prompt', 'unsupported'] as const)('does not schedule when the permission is %s', async (permission) => {
		const { port, fetchPlan, scheduler } = setup({ permission });
		await scheduler.replan();
		expect(fetchPlan).not.toHaveBeenCalled();
		expect(port.scheduled).toEqual([]);
	});
	it('keeps what is scheduled when the plan cannot be fetched, and never throws', async () => {
		const { port, fetchPlan, scheduler } = setup();
		fetchPlan.mockRejectedValueOnce(new Error('offline'));
		await expect(scheduler.replan()).resolves.toBeUndefined();
		expect(port.calls).not.toContain('cancelAll');
	});
	it('only cancels when the plan has no future slot', async () => {
		const { port, scheduler } = setup({ slots: [slot(3, 'streak', '2026-11-25T08:00:00Z', 4)] });
		await scheduler.replan();
		expect(port.calls).toEqual(['permissionStatus', 'cancelAll']);
	});
	it('runs one replan at a time and runs again once when asked meanwhile', async () => {
		const { fetchPlan, scheduler } = setup();
		await Promise.all([scheduler.replan(), scheduler.replan(), scheduler.replan()]);
		expect(fetchPlan.mock.calls.length).toBe(2);
	});
});

describe('stale text after a local study change (A)', () => {
	it('cancels the scheduled notifications when the plan cannot be fetched after a local change', async () => {
		const { port, fetchPlan, scheduler } = setup();
		await scheduler.replan();
		expect(port.scheduled.length).toBe(2);
		scheduler.markStale();
		fetchPlan.mockRejectedValueOnce(new Error('offline'));
		await expect(scheduler.replan()).resolves.toBeUndefined();
		expect(port.scheduled).toEqual([]);
	});
	it('does not trust the server plan when publishing the facts failed after a local change', async () => {
		const { port, fetchPlan, scheduler } = setup();
		await scheduler.replan();
		fetchPlan.mockClear();
		scheduler.markStale();
		await scheduler.replan({ factsFailed: true });
		expect(fetchPlan).not.toHaveBeenCalled();
		expect(port.scheduled).toEqual([]);
	});
	it('keeps the old ones when nothing changed locally and the plan cannot be fetched (B: offline, no local change)', async () => {
		const { port, fetchPlan, scheduler } = setup();
		await scheduler.replan();
		fetchPlan.mockRejectedValueOnce(new Error('offline'));
		await scheduler.replan({ factsFailed: true });
		expect(port.scheduled.length).toBe(2);
	});
	it('a successful replan after the facts went out clears the stale mark', async () => {
		const { port, fetchPlan, scheduler } = setup();
		scheduler.markStale();
		await scheduler.replan();
		expect(port.scheduled.length).toBe(2);
		fetchPlan.mockRejectedValueOnce(new Error('offline'));
		await scheduler.replan();
		expect(port.scheduled.length).toBe(2);
	});
});

describe('cancel', () => {
	it('waits for a running replan and leaves nothing scheduled (logout racing a replan)', async () => {
		const { port, fetchPlan, scheduler } = setup();
		let release: (p: ReminderPlan) => void = () => undefined;
		fetchPlan.mockImplementationOnce(() => new Promise<ReminderPlan>((r) => (release = r)));
		const running = scheduler.replan();
		await vi.waitFor(() => expect(fetchPlan).toHaveBeenCalled());
		const cancelled = scheduler.cancel();
		release(plan([slot(1, 'due', '2026-11-25T17:00:00Z', 15)]));
		await Promise.all([running, cancelled]);
		expect(port.scheduled).toEqual([]);
		expect(port.calls[port.calls.length - 1]).toBe('cancelAll');
		expect(port.calls).not.toContain('schedule:1');
	});
	it('stops a queued second pass and any later replan', async () => {
		const { port, fetchPlan, scheduler } = setup();
		let release: (p: ReminderPlan) => void = () => undefined;
		fetchPlan.mockImplementationOnce(() => new Promise<ReminderPlan>((r) => (release = r)));
		const first = scheduler.replan();
		void scheduler.replan();
		await vi.waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(1));
		const cancelled = scheduler.cancel();
		release(plan([slot(1, 'due', '2026-11-25T17:00:00Z', 15)]));
		await Promise.all([first, cancelled]);
		await scheduler.replan();
		expect(fetchPlan).toHaveBeenCalledTimes(1);
		expect(port.scheduled).toEqual([]);
	});

	it('cancels everything', async () => {
		const { port, scheduler } = setup();
		await scheduler.replan();
		await scheduler.cancel();
		expect(port.scheduled).toEqual([]);
	});
	it('does nothing outside the shell', async () => {
		const { port, scheduler } = setup({ shell: false });
		await scheduler.cancel();
		expect(port.calls).toEqual([]);
	});
});

describe('the daily replan', () => {
	it('replans every 24 hours while started and stops when stopped', async () => {
		const { fetchPlan, timers, scheduler } = setup();
		scheduler.start();
		timers.advance(24 * 3_600_000);
		await vi.waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(1));
		timers.advance(24 * 3_600_000);
		await vi.waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
		scheduler.stop();
		expect(timers.pending()).toBe(0);
	});
});
