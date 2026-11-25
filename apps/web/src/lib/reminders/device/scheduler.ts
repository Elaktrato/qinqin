// The Android shell's reminder scheduler (#137), web side. It plans local notifications from the server's plan
// (GET /api/reminders/plan, 7 days) and hands them to the device port (port.ts); the shell's native module
// (lib/native/notifications) is the port's implementation.
//
// INTEGRATION STEP (the one thing that wires the real port, done outside this folder):
//   in the app's startup, call  setDevicePort(nativeNotifications)  from './port', where `nativeNotifications`
//   is the module from lib/native/notifications. Until then the port reports 'unsupported' and nothing is scheduled.
//
// Triggers (wired by runtime.ts): app start, a settings change, after the facts were published (facts first,
// then replan), once a day while the app runs (start()), cancel on every session end and when reminders or the
// device channel are switched off (replan notices it). A replan is serialised: one at a time, and a request made
// meanwhile runs once more afterwards. It never throws: a failed plan fetch keeps what is scheduled.

import { isShell as shellPredicate } from '$lib/native/shell';
import type { MessageArgs, MessageKey } from '$lib/i18n';
import type { Timers } from '$lib/context/deps';
import { slotText, type ReminderPlan } from '../plan';
import type { ReminderSettings } from '../settings';
import type { DevicePort } from './port';

export const PLAN_DAYS = 7;
const DAY_MS = 24 * 3_600_000;
const ROUTE = '/study';

export interface DeviceSchedulerDeps {
	port: DevicePort;
	fetchPlan: (days: number) => Promise<ReminderPlan>;
	/** The current reminder settings (read fresh from the row). */
	settings: () => Promise<ReminderSettings>;
	now: () => number;
	translate: (key: MessageKey, args?: MessageArgs) => string;
	/** Defaults to the shell check of lib/native/shell. */
	isShell?: () => boolean;
	/** For the daily replan of start(). */
	timers?: Timers;
}

export interface DeviceScheduler {
	replan(): Promise<void>;
	cancel(): Promise<void>;
	/** Replans once a day while running (needs `timers`). */
	start(): void;
	stop(): void;
}

export function createDeviceScheduler(deps: DeviceSchedulerDeps): DeviceScheduler {
	const inShell = deps.isShell ?? shellPredicate;
	let running: Promise<void> | null = null;
	let again = false;
	let daily: unknown = null;

	async function once(): Promise<void> {
		const settings = await deps.settings();
		if (!settings.enabled || !settings.channels.device) {
			await deps.port.cancelAll();
			return;
		}
		if ((await deps.port.permissionStatus()) !== 'granted') return;
		const plan = await deps.fetchPlan(PLAN_DAYS);
		const now = deps.now();
		const items = plan.slots
			.filter((slot) => Date.parse(slot.at) > now)
			.map((slot) => {
				const text = slotText(slot);
				return {
					id: slot.id,
					title: deps.translate(text.titleKey),
					body: deps.translate(text.bodyKey, { count: text.count }),
					at: new Date(slot.at),
					route: ROUTE
				};
			});
		await deps.port.cancelAll();
		if (items.length > 0) await deps.port.schedule(items);
	}

	async function loop(): Promise<void> {
		do {
			again = false;
			try {
				await once();
			} catch (err) {
				console.warn('reminders: the device plan could not be scheduled', err);
			}
		} while (again);
	}

	return {
		replan() {
			if (!inShell()) return Promise.resolve();
			if (running !== null) {
				again = true;
				return running;
			}
			running = loop().finally(() => (running = null));
			return running;
		},
		async cancel() {
			if (!inShell()) return;
			try {
				await deps.port.cancelAll();
			} catch (err) {
				console.warn('reminders: the device notifications could not be cancelled', err);
			}
		},
		start() {
			if (daily !== null || !deps.timers) return;
			daily = deps.timers.every(() => void this.replan(), DAY_MS);
		},
		stop() {
			if (daily === null || !deps.timers) return;
			deps.timers.stop(daily);
			daily = null;
		}
	};
}
