import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDocument, fakeWindow, manualTimers, studyContext, type TestContext } from '$lib/testing/context';
import { defaultReminderSettings } from './settings';
import { fakePort } from './device/port';

const listeners: ((ws: number) => void)[] = [];
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	onStudyChange: vi.fn((_study: unknown, l: (ws: number) => void) => {
		listeners.push(l);
		return () => listeners.splice(listeners.indexOf(l), 1);
	})
}));

import { REMINDERS_CHANGED, notifyRemindersChanged, startReminders } from './runtime';

let ctx: TestContext;
beforeEach(() => {
	listeners.length = 0;
	ctx = studyContext();
});
afterEach(() => vi.restoreAllMocks());

function setup(enabled = true, shell = true) {
	const manual = manualTimers();
	const clock = { ms: 1_000_000 };
	const timers = { ...manual, advance: (ms: number) => { clock.ms += ms; manual.advance(ms); } };
	const win = fakeWindow();
	const doc = fakeDocument();
	const publish = vi.fn(async (_ws: number) => undefined);
	const port = fakePort();
	const settings = { ...defaultReminderSettings(), enabled, channels: { email: false, push: false, device: true } };
	const fetchPlan = vi.fn(async () => ({
		generatedAt: '',
		zone: 'UTC',
		enabled,
		channels: { email: false, push: false, device: true },
		available: { email: false, push: false },
		slots: [{ id: 1, kind: 'goal' as const, at: new Date(Date.now() + 3_600_000).toISOString(), local: '', day: '', count: null }]
	}));
	const stop = startReminders(ctx.session, {
		timers: manual,
		now: () => clock.ms,
		window: win,
		document: doc,
		loadSettings: async () => settings,
		publish,
		port,
		fetchPlan,
		isShell: () => shell,
		workspaces: () => [3],
		texts: null
	});
	return { timers, win, doc, publish, port, fetchPlan, stop };
}

const settle = async () => {
	await new Promise((r) => setTimeout(r, 0));
	await new Promise((r) => setTimeout(r, 0));
};

describe('startReminders', () => {
	it('publishes the facts after start, then replans the device', async () => {
		const { timers, publish, port } = setup();
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledWith(3);
		expect(port.scheduled.map((s) => s.id)).toEqual([1]);
	});
	it('publishes nothing for an account that never enabled reminders, and cancels the device notifications', async () => {
		const { timers, publish, port } = setup(false);
		await port.schedule([{ id: 9, title: 'x', body: 'y', at: new Date(Date.now() + 1000) }]);
		timers.advance(5000);
		await settle();
		expect(publish).not.toHaveBeenCalled();
		expect(port.scheduled).toEqual([]);
	});
	it('republishes after a study change and after a settings change', async () => {
		const { timers, win, publish } = setup();
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(1);
		timers.advance(60_000);
		listeners.forEach((l) => l(3));
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(2);
		timers.advance(60_000);
		win.dispatch(new Event(REMINDERS_CHANGED));
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(3);
	});
	it('republishes and replans when the app comes back to the foreground, and when the network returns (7-day horizon)', async () => {
		const { timers, win, doc, publish, fetchPlan } = setup();
		timers.advance(5000);
		await settle();
		const plans = fetchPlan.mock.calls.length;
		timers.advance(60_000);
		doc.visibilityState = 'hidden';
		doc.dispatch(new Event('visibilitychange'));
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(1);
		doc.visibilityState = 'visible';
		doc.dispatch(new Event('visibilitychange'));
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(2);
		expect(fetchPlan.mock.calls.length).toBeGreaterThan(plans);
		timers.advance(60_000);
		win.dispatch(new Event('online'));
		timers.advance(5000);
		await settle();
		expect(publish).toHaveBeenCalledTimes(3);
	});
	it('drops the stale notifications when a local study change cannot be published or planned (offline)', async () => {
		const { timers, publish, port, fetchPlan } = setup();
		timers.advance(5000);
		await settle();
		expect(port.scheduled.length).toBe(1);
		publish.mockRejectedValue(new Error('offline'));
		fetchPlan.mockRejectedValue(new Error('offline'));
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		timers.advance(60_000);
		listeners.forEach((l) => l(3));
		timers.advance(5000);
		await settle();
		expect(port.scheduled).toEqual([]);
	});
	it('replans once a day while running', async () => {
		const { timers, fetchPlan } = setup();
		timers.advance(5000);
		await settle();
		const before = fetchPlan.mock.calls.length;
		timers.advance(24 * 3_600_000);
		await settle();
		expect(fetchPlan.mock.calls.length).toBeGreaterThan(before);
	});
	it('stop unhooks everything', async () => {
		const { timers, publish, stop } = setup();
		stop();
		expect(listeners).toHaveLength(0);
		timers.advance(10_000);
		await settle();
		expect(publish).not.toHaveBeenCalled();
	});
	it('cancels the device notifications when the session ends (sign-out)', async () => {
		const { timers, port } = setup();
		timers.advance(5000);
		await settle();
		expect(port.scheduled.length).toBe(1);
		ctx.session.dispose('signOut');
		await settle();
		expect(port.scheduled).toEqual([]);
	});
});
