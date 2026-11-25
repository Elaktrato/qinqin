// Web push, page side (#139; docs/contracts/reminders/README.md "Push: routes", docs/contracts/pwa/README.md
// "Push notifications"). `enablePush` MUST be called from a click handler: the browser only shows the
// permission prompt for a user gesture, so it asks for the permission before anything else. Never runs in the
// Android shell (its reminders are local notifications, lib/reminders/device). The id the server answers for
// this browser's subscription is remembered in localStorage per user, so this device can be marked in the list
// and deleted at sign-out. Every function takes its dependencies (api, browser environment, user).

import { api as defaultApi, ApiError } from '../api/client';
import { isShell } from '$lib/native/shell';
import { t } from '$lib/i18n';

export type PushUnsupported = 'shell' | 'insecure' | 'unsupported' | 'iosInstall';
export type PushSupport = { ok: true } | { ok: false; reason: PushUnsupported };

export interface PushManagerLike {
	getSubscription(): Promise<SubscriptionLike | null>;
	subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
}

export interface SubscriptionLike {
	toJSON(): unknown;
	unsubscribe(): Promise<boolean>;
	options?: { applicationServerKey?: ArrayBuffer | null };
}

/** What the browser offers; browserPushEnv() reads the globals, tests pass fakes. */
export interface PushEnv {
	isShell(): boolean;
	isSecureContext: boolean;
	hasServiceWorker: boolean;
	hasPushManager: boolean;
	hasNotification: boolean;
	/** The page runs as an installed app (display-mode standalone, iOS navigator.standalone). */
	standalone: boolean;
	ios: boolean;
	permission(): NotificationPermission | 'unsupported';
	requestPermission(): Promise<NotificationPermission>;
	registration(): Promise<{ pushManager: PushManagerLike }>;
	local(): Storage | null;
	deviceLabel(): string;
}

export interface PushDeps {
	api: typeof defaultApi;
	env: PushEnv;
	user: number | null;
}

/** A browser device label for the list (at most 80 characters). */
function labelOfBrowser(): string {
	const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { userAgentData?: { platform?: string } });
	const platform = (nav?.userAgentData?.platform || nav?.platform || '').trim();
	const label = platform === '' ? t('settings.reminders.push.deviceLabelPlain') : t('settings.reminders.push.deviceLabel', { platform });
	return label.slice(0, 80);
}

export function browserPushEnv(): PushEnv {
	const nav = typeof navigator === 'undefined' ? null : navigator;
	const ua = nav?.userAgent ?? '';
	const ios = /iPad|iPhone|iPod/.test(ua) || (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
	let standalone = false;
	try {
		standalone =
			(nav as (Navigator & { standalone?: boolean }) | null)?.standalone === true ||
			(typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
	} catch {
		standalone = false;
	}
	return {
		isShell,
		isSecureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
		hasServiceWorker: nav !== null && 'serviceWorker' in nav,
		hasPushManager: typeof PushManager !== 'undefined',
		hasNotification: typeof Notification !== 'undefined',
		standalone,
		ios,
		permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
		requestPermission: () => Notification.requestPermission(),
		registration: () => navigator.serviceWorker.ready as unknown as Promise<{ pushManager: PushManagerLike }>,
		local: () => {
			try {
				return typeof localStorage === 'undefined' ? null : localStorage;
			} catch {
				return null;
			}
		},
		deviceLabel: labelOfBrowser
	};
}

/** pushSupport: whether this page can use web push, or the one reason it cannot (never in the shell). */
export function pushSupport(env: PushEnv = browserPushEnv()): PushSupport {
	if (env.isShell()) return { ok: false, reason: 'shell' };
	if (!env.isSecureContext) return { ok: false, reason: 'insecure' };
	if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return { ok: false, reason: 'unsupported' };
	if (env.ios && !env.standalone) return { ok: false, reason: 'iosInstall' };
	return { ok: true };
}

/** The localStorage key holding this browser's subscription id for a user. */
export function deviceIdKey(user: number | null): string {
	return `qinqin.push.device.${user ?? 'unknown'}`;
}

function storedId(env: PushEnv, user: number | null): number | null {
	try {
		const raw = env.local()?.getItem(deviceIdKey(user)) ?? null;
		const id = raw === null ? NaN : Number(raw);
		return Number.isInteger(id) && id > 0 ? id : null;
	} catch {
		return null;
	}
}

function remember(env: PushEnv, user: number | null, id: number | null): void {
	try {
		if (id === null) env.local()?.removeItem(deviceIdKey(user));
		else env.local()?.setItem(deviceIdKey(user), String(id));
	} catch {
		// Storage denied: this device is simply not marked in the list.
	}
}

/** urlBase64ToBytes decodes a base64url string (no padding) to bytes. */
export function urlBase64ToBytes(value: string): Uint8Array {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
	if (!a) return true; // not exposed by the browser: assume it matches, the subscribe error path covers a mismatch
	const x = new Uint8Array(a);
	return x.length === b.length && x.every((v, i) => v === b[i]);
}

export type EnableResult =
	| { ok: true; id: number }
	| { ok: false; reason: PushUnsupported | 'denied' | 'serverUnavailable' | 'tooMany' | 'failed' };

/**
 * enablePush: permission, the server's VAPID key, a push subscription, and the server's record of it.
 * Call from a click handler (the permission request needs the gesture, so it comes first).
 */
export async function enablePush(deps: PushDeps): Promise<EnableResult> {
	const { api, env, user } = deps;
	const support = pushSupport(env);
	if (!support.ok) return support;
	let permission: NotificationPermission;
	try {
		permission = await env.requestPermission();
	} catch {
		return { ok: false, reason: 'failed' };
	}
	if (permission !== 'granted') return { ok: false, reason: 'denied' };
	let fresh: SubscriptionLike | null = null;
	try {
		const answer = await api<{ publicKey?: unknown }>('/api/push/vapid-key');
		if (typeof answer?.publicKey !== 'string') return { ok: false, reason: 'failed' };
		const key = urlBase64ToBytes(answer.publicKey);
		const { pushManager } = await env.registration();
		let subscription = await pushManager.getSubscription();
		if (subscription !== null && !sameKey(subscription.options?.applicationServerKey, key)) {
			await subscription.unsubscribe();
			subscription = null;
		}
		if (subscription === null) {
			subscription = fresh = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
		}
		const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
		const saved = await api<{ id?: unknown }>('/api/push/subscriptions', {
			method: 'POST',
			body: { endpoint: json.endpoint, keys: json.keys, label: env.deviceLabel() }
		});
		if (typeof saved?.id !== 'number') throw new Error('push: the server sent no subscription id');
		remember(env, user, saved.id);
		return { ok: true, id: saved.id };
	} catch (err) {
		// A subscription the server did not take is no use to anyone: give it back.
		await fresh?.unsubscribe().catch(() => false);
		if (err instanceof ApiError && err.code === 'push_unavailable') return { ok: false, reason: 'serverUnavailable' };
		if (err instanceof ApiError && err.code === 'too_many_subscriptions') return { ok: false, reason: 'tooMany' };
		return { ok: false, reason: 'failed' };
	}
}

async function localSubscription(env: PushEnv): Promise<SubscriptionLike | null> {
	try {
		return await (await env.registration()).pushManager.getSubscription();
	} catch {
		return null;
	}
}

async function deleteOnServer(api: PushDeps['api'], id: number): Promise<void> {
	try {
		await api(`/api/push/subscriptions/${id}`, { method: 'DELETE' });
	} catch (err) {
		// Gone already (404) is done; anything else (offline) is for the caller.
		if (!(err instanceof ApiError && err.status === 404)) throw err;
	}
}

/** disablePush deletes this device's subscription on the server, then in the browser. A server failure rejects (retry). */
export async function disablePush(deps: PushDeps): Promise<void> {
	const { api, env, user } = deps;
	const id = storedId(env, user);
	if (id !== null) await deleteOnServer(api, id);
	await (await localSubscription(env))?.unsubscribe().catch(() => false);
	remember(env, user, null);
}

/** thisDeviceSubscribed: this browser has a subscription the server knows (the remembered id and a live subscription). */
export async function thisDeviceSubscribed(deps: Pick<PushDeps, 'env' | 'user'>): Promise<boolean> {
	if (storedId(deps.env, deps.user) === null) return false;
	return (await localSubscription(deps.env)) !== null;
}

export interface PushDevice {
	id: number;
	label: string;
	createdAt: string;
	lastSuccessAt: string | null;
	current: boolean;
}

/** listDevices: the account's subscribed devices (never their endpoints), this one marked. */
export async function listDevices(deps: PushDeps): Promise<PushDevice[]> {
	const answer = await deps.api<{ subscriptions?: unknown }>('/api/push/subscriptions');
	const mine = storedId(deps.env, deps.user);
	const list = Array.isArray(answer?.subscriptions) ? (answer.subscriptions as unknown[]) : [];
	return list.flatMap((raw) => {
		if (typeof raw !== 'object' || raw === null) return [];
		const r = raw as Record<string, unknown>;
		if (typeof r.id !== 'number' || typeof r.label !== 'string') return [];
		return [
			{
				id: r.id,
				label: r.label,
				createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
				lastSuccessAt: typeof r.lastSuccessAt === 'string' ? r.lastSuccessAt : null,
				current: r.id === mine
			}
		];
	});
}

/** removeDevice deletes one subscription; for this device it also unsubscribes the browser. */
export async function removeDevice(deps: PushDeps, id: number): Promise<void> {
	if (id === storedId(deps.env, deps.user)) {
		await disablePush(deps);
		return;
	}
	await deleteOnServer(deps.api, id);
}

/**
 * forgetThisDevice: at sign-out, delete this device's subscription. Best effort and never blocks: the DELETE is
 * started synchronously (the request still carries the token, which the caller clears right after), everything
 * else runs in the background.
 */
export function forgetThisDevice(deps: PushDeps): void {
	try {
		const { api, env, user } = deps;
		if (env.isShell()) return;
		const id = storedId(env, user);
		if (id === null) return;
		const sent = deleteOnServer(api, id).catch(() => undefined);
		remember(env, user, null);
		void sent.then(async () => {
			try {
				await (await localSubscription(env))?.unsubscribe();
			} catch {
				// The browser keeps a subscription the server no longer knows: it is simply never pushed to.
			}
		});
	} catch {
		// Sign-out is never blocked.
	}
}
