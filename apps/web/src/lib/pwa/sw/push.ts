// Push notifications in the service worker (#139, docs/contracts/pwa/README.md "Push notifications"). Pure
// handlers with injected dependencies; worker.ts wires them to the real events. The payload carries no text
// (docs/contracts/reminders/README.md): kind, count and route only; the text comes from the page's stored map
// (pushTexts.ts). Nothing here caches a payload or touches /api/.

import { pushText, type PushTexts, type PushTextKey } from './pushTexts';

export type PushKind = 'due' | 'goal' | 'streak' | 'test' | 'generic';

export interface PushPayload {
	kind: PushKind;
	count: number | null;
	route: string;
}

const KINDS: readonly string[] = ['due', 'goal', 'streak', 'test'];
const DEFAULT_ROUTE = '/study';
const ICON = '/icons/icon-192.png';

/** safeRoute: an in-app path (one leading slash, no scheme, host or backslash); anything else is /study. */
export function safeRoute(route: unknown): string {
	if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return DEFAULT_ROUTE;
	if (route.includes('\\') || /[\u0000-\u001f\u007f]/.test(route)) return DEFAULT_ROUTE;
	return route;
}

/** parsePushPayload reads the data of a push event defensively: a payload that is not the contract's shows a generic one. */
export function parsePushPayload(data: { json(): unknown } | null): PushPayload {
	const generic: PushPayload = { kind: 'generic', count: null, route: DEFAULT_ROUTE };
	if (data === null) return generic;
	let raw: unknown;
	try {
		raw = data.json();
	} catch {
		return generic;
	}
	if (typeof raw !== 'object' || raw === null) return generic;
	const { kind, count, route } = raw as Record<string, unknown>;
	if (typeof kind !== 'string' || !KINDS.includes(kind)) return generic;
	return {
		kind: kind as PushKind,
		count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null,
		route: safeRoute(route)
	};
}

const KEYS: Record<PushKind, { title: PushTextKey; body: PushTextKey }> = {
	due: { title: 'settings.reminders.notify.due.title', body: 'settings.reminders.notify.due.body' },
	goal: { title: 'settings.reminders.notify.goal.title', body: 'settings.reminders.notify.goal.body' },
	streak: { title: 'settings.reminders.notify.streak.title', body: 'settings.reminders.notify.streak.body' },
	test: { title: 'settings.reminders.notify.test.title', body: 'settings.reminders.notify.test.body' },
	generic: { title: 'settings.reminders.notify.generic.title', body: 'settings.reminders.notify.generic.body' }
};

export interface PushEv {
	data: { json(): unknown } | null;
	waitUntil(promise: Promise<unknown>): void;
}

export interface PushDeps {
	show(title: string, options: { body: string; tag: string; icon: string; data: { route: string } }): Promise<void>;
	texts(): Promise<PushTexts | null>;
}

/** onPush shows the notification; the tag is the kind, so a newer one replaces an older one. Never throws. */
export function onPush(event: PushEv, deps: PushDeps): void {
	event.waitUntil(
		(async () => {
			const payload = parsePushPayload(event.data);
			let texts: PushTexts | null = null;
			try {
				texts = await deps.texts();
			} catch {
				// No stored texts: the English fallback.
			}
			const keys = KEYS[payload.kind];
			await deps.show(pushText(keys.title, texts, payload.count), {
				body: pushText(keys.body, texts, payload.count),
				tag: payload.kind,
				icon: ICON,
				data: { route: payload.route }
			});
		})().catch(() => undefined)
	);
}

export interface ClientLike {
	url: string;
	focus(): Promise<unknown>;
	navigate?(url: string): Promise<unknown>;
}

export interface ClickEv {
	notification: { close(): void; data?: unknown };
	waitUntil(promise: Promise<unknown>): void;
}

export interface ClickDeps {
	clients: {
		matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly ClientLike[]>;
		openWindow(url: string): Promise<unknown>;
	};
	origin: string;
}

/** onNotificationClick closes the notification, then focuses an open window and sends it to the route, or opens one. */
export function onNotificationClick(event: ClickEv, deps: ClickDeps): void {
	event.notification.close();
	const data = event.notification.data;
	const route = safeRoute(typeof data === 'object' && data !== null ? (data as { route?: unknown }).route : undefined);
	const target = new URL(route, deps.origin).href;
	event.waitUntil(
		(async () => {
			const open = await deps.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const client = open[0];
			if (client === undefined) {
				await deps.clients.openWindow(target);
				return;
			}
			await client.focus();
			if (client.url !== target && client.navigate) await client.navigate(target);
		})().catch(() => undefined)
	);
}
