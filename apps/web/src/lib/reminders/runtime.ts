// The reminders runtime of one session (#137): keeps the server's facts fresh and the Android shell's local
// notifications planned. Started by the root layout once the session's workspaces are known; the session's end
// stops it (and cancels the device notifications). Nothing here throws into the UI.
//
// Triggers: app start, a study change (a write or a sync round that brought rows), a settings change
// (notifyRemindersChanged), the app coming back to the foreground or online, once a day (the device replan).
// Facts go first, then the device replan.

import type { Session } from '$lib/context/session.svelte';
import type { EventSource, Timers, VisibilitySource } from '$lib/context/deps';
import { getFormatLocale, rawMessage, t } from '$lib/i18n';
import { onStudyChange } from '$lib/study/data';
import { clearPushTexts, pushTextsOf, writePushTexts } from '$lib/pwa/sw/pushTexts';
import { isShell } from '$lib/native/shell';
import { devicePort, type DevicePort } from './device/port';
import { createDeviceScheduler } from './device/scheduler';
import { publishFacts } from './facts';
import { fetchPlan as defaultFetchPlan, type ReminderPlan } from './plan';
import { createFactsPublisher } from './publisher';
import { loadReminderSettings, type ReminderSettings } from './settings';

/** The window event the Settings tab fires after a save, so the runtime republishes and replans. */
export const REMINDERS_CHANGED = 'qinqin:reminders-changed';

export function notifyRemindersChanged(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(REMINDERS_CHANGED));
}

export interface RemindersDeps {
	timers: Timers;
	window: EventSource | null;
	/** For the foreground event (a resumed app replans); null: none. */
	document: VisibilitySource | null;
	loadSettings: () => Promise<ReminderSettings>;
	publish: (workspaceId: number) => Promise<void>;
	port: DevicePort;
	fetchPlan: (days: number) => Promise<ReminderPlan>;
	isShell: () => boolean;
	now: () => number;
	workspaces: () => number[];
	/** The CacheStorage the push texts go to (null: none). */
	texts: CacheStorage | null;
}

function browserCaches(): CacheStorage | null {
	try {
		return typeof caches === 'undefined' ? null : caches;
	} catch {
		return null;
	}
}

/** startReminders wires the runtime to the session; returns the stop (also run by the session's end). */
export function startReminders(session: Session, over: Partial<RemindersDeps> = {}): () => void {
	const deps: RemindersDeps = {
		timers: session.deps.timers,
		window: session.deps.window,
		document: session.deps.document,
		loadSettings: () => loadReminderSettings(),
		publish: (workspaceId) => publishFacts(session, workspaceId),
		port: devicePort,
		fetchPlan: defaultFetchPlan,
		isShell,
		now: () => session.deps.now(),
		workspaces: () => session.workspaces.list.map((w) => w.id),
		texts: browserCaches(),
		...over
	};
	const scheduler = createDeviceScheduler({
		port: deps.port,
		fetchPlan: deps.fetchPlan,
		settings: deps.loadSettings,
		now: deps.now,
		translate: t,
		isShell: deps.isShell,
		timers: deps.timers
	});
	const publisher = createFactsPublisher({
		timers: deps.timers,
		now: deps.now,
		enabled: async () => (await deps.loadSettings()).enabled,
		workspaces: deps.workspaces,
		publish: deps.publish,
		after: ({ published }) => scheduler.replan({ factsFailed: !published })
	});
	const request = (): void => publisher.request();
	// A local study change makes the planned counts stale until the facts went out and a plan came back.
	const offStudy = onStudyChange(session.study, () => {
		scheduler.markStale();
		request();
	});
	// The plan covers 7 days and there is no background replan (ADR 0011): every open, resume and return of the
	// network refreshes it. The publisher debounces (5 s, one run a minute).
	const onVisible = (): void => {
		if (deps.document?.visibilityState === 'visible') request();
	};
	deps.window?.addEventListener(REMINDERS_CHANGED, request);
	deps.window?.addEventListener('online', request);
	deps.document?.addEventListener('visibilitychange', onVisible);
	scheduler.start();
	// The worker formats push texts from this map (pwa/sw/pushTexts.ts); not in the shell, which has no push.
	if (deps.texts !== null && !deps.isShell()) {
		void writePushTexts(deps.texts, pushTextsOf(rawMessage, getFormatLocale())).catch(() => undefined);
	}
	request();

	let stopped = false;
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		publisher.stop();
		scheduler.stop();
		offStudy();
		deps.window?.removeEventListener(REMINDERS_CHANGED, request);
		deps.window?.removeEventListener('online', request);
		deps.document?.removeEventListener('visibilitychange', onVisible);
	};
	session.onDispose(() => {
		stop();
		void scheduler.cancel();
		if (deps.texts !== null) void clearPushTexts(deps.texts).catch(() => undefined);
	});
	return stop;
}
