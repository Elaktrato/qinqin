// The Android shell's reminder scheduler (#137), web side. It plans local notifications from the server's plan
// (GET /api/reminders/plan, 7 days) and hands them to the device port (port.ts); the shell's native module
// (lib/native/notifications) is the port's implementation.
//
// The real port is installed by routes/+layout.svelte (setDevicePort(shellPort)); until then the port reports
// 'unsupported' and nothing is scheduled.
//
// Limits (ADR 0011, wiki "Reminders"): the plan is 7 days, so the notifications run out a week after the app was
// last opened (a native background replan is a follow-up); counts that another device changed cannot be known
// offline; after a LOCAL study change whose facts or plan cannot be fetched, the notifications are cancelled
// rather than left with old counts (markStale).
//
// Triggers (wired by runtime.ts): app start, a settings change, after the facts were published (facts first,
// then replan), the app coming to the foreground, once a day while the app runs (start()), cancel on every session end and when reminders or the
// device channel are switched off (replan notices it). A replan is serialised: one at a time, and a request made
// meanwhile runs once more afterwards. cancel() ends the scheduler for good: it waits for the running replan, which
// stops at its next step, so a replan cannot schedule after sign-out. It never throws: a failed plan fetch keeps
// what is scheduled (unless a local study change made it stale).

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

export interface ReplanOptions {
	/** The facts could not be published just before: the server's plan is built from older ones. */
	factsFailed?: boolean;
}

export interface DeviceScheduler {
	replan(options?: ReplanOptions): Promise<void>;
	/** The study changed on this device: scheduled counts are out of date until a replan from fresh facts succeeds. */
	markStale(): void;
	/** Ends the scheduler: waits for a running replan, cancels everything; later replans do nothing. */
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
	let stopped = false;
	let stale = false;
	let factsFailed = false;

	async function cancelQuietly(): Promise<void> {
		try {
			await deps.port.cancelAll();
		} catch (err) {
			console.warn('reminders: the device notifications could not be cancelled', err);
		}
	}

	async function once(): Promise<void> {
		const settings = await deps.settings();
		if (stopped) return;
		if (!settings.enabled || !settings.channels.device) {
			await deps.port.cancelAll();
			return;
		}
		if ((await deps.port.permissionStatus()) !== 'granted' || stopped) return;
		if (stale && factsFailed) {
			// This device's study is not on the server: its plan would carry the old counts. Show nothing until it is.
			await deps.port.cancelAll();
			return;
		}
		let plan: ReminderPlan;
		try {
			plan = await deps.fetchPlan(PLAN_DAYS);
		} catch (err) {
			if (stale && !stopped) await cancelQuietly();
			throw err;
		}
		if (stopped) return;
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
		if (!factsFailed) stale = false;
	}

	async function loop(): Promise<void> {
		do {
			again = false;
			try {
				await once();
			} catch (err) {
				console.warn('reminders: the device plan could not be scheduled', err);
			}
		} while (again && !stopped);
	}

	return {
		replan(options) {
			if (!inShell() || stopped) return Promise.resolve();
			factsFailed = options?.factsFailed === true;
			if (running !== null) {
				again = true;
				return running;
			}
			running = loop().finally(() => (running = null));
			return running;
		},
		markStale() {
			stale = true;
		},
		async cancel() {
			if (!inShell()) return;
			stopped = true;
			// Behind the running replan: its loop stops at the next step, and what it already scheduled goes too.
			await running?.catch(() => undefined);
			await cancelQuietly();
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
