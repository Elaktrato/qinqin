import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { memoryStorage } from '../testing/context';
import {
	deviceIdKey,
	disablePush,
	enablePush,
	forgetThisDevice,
	listDevices,
	pushSupport,
	removeDevice,
	urlBase64ToBytes,
	type PushEnv
} from './push';

// base64url of 65 bytes 4,0,1,...,63 (an uncompressed-point shaped key).
const KEY_BYTES = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => i)]);
const KEY = btoa(String.fromCharCode(...KEY_BYTES)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

function subscription(endpoint = 'https://push.example/s/1') {
	return {
		endpoint,
		options: { applicationServerKey: null as ArrayBuffer | null },
		toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'P', auth: 'A' } }),
		unsubscribe: vi.fn(async () => true)
	};
}

function envOf(over: Partial<PushEnv> & { permission?: NotificationPermission; request?: NotificationPermission; sub?: ReturnType<typeof subscription> | null } = {}) {
	const sub = over.sub === undefined ? null : over.sub;
	const state = { sub };
	const manager = {
		getSubscription: vi.fn(async () => state.sub),
		subscribe: vi.fn(async (_options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => (state.sub = subscription()))
	};
	const requestPermission = vi.fn(async (): Promise<NotificationPermission> => over.request ?? 'granted');
	const local = memoryStorage();
	const env: PushEnv = {
		isShell: () => false,
		isSecureContext: true,
		hasServiceWorker: true,
		hasPushManager: true,
		hasNotification: true,
		standalone: false,
		ios: false,
		permission: () => over.permission ?? 'default',
		requestPermission,
		registration: async () => ({ pushManager: manager }),
		local: () => local,
		deviceLabel: () => 'Browser on Linux',
		...over
	} as PushEnv;
	return { env, manager, requestPermission, local: () => local, state };
}

function fakeApi(routes: Record<string, unknown>) {
	return vi.fn(async (path: string, options: { method?: string; body?: unknown } = {}) => {
		const key = `${options.method ?? 'GET'} ${path}`;
		if (!(key in routes)) throw new ApiError(404, JSON.stringify({ error: 'not_found', message: key }));
		const r = routes[key];
		if (typeof r === 'function') return (r as (b: unknown) => unknown)(options.body);
		if (r instanceof Error) throw r;
		return r;
	}) as never;
}

describe('pushSupport', () => {
	it('is ok in a secure browser with the APIs', () => expect(pushSupport(envOf().env)).toEqual({ ok: true }));
	it('is never available in the Android shell', () => expect(pushSupport(envOf({ isShell: () => true }).env)).toEqual({ ok: false, reason: 'shell' }));
	it('needs HTTPS', () => expect(pushSupport(envOf({ isSecureContext: false }).env)).toEqual({ ok: false, reason: 'insecure' }));
	it.each([['hasServiceWorker'], ['hasPushManager'], ['hasNotification']])('is unsupported without %s', (k) =>
		expect(pushSupport(envOf({ [k]: false } as never).env)).toEqual({ ok: false, reason: 'unsupported' }));
	it('on iOS only works as an installed home-screen app', () => {
		expect(pushSupport(envOf({ ios: true, standalone: false }).env)).toEqual({ ok: false, reason: 'iosInstall' });
		expect(pushSupport(envOf({ ios: true, standalone: true }).env)).toEqual({ ok: true });
	});
});

describe('urlBase64ToBytes', () => {
	it('decodes base64url without padding', () => expect([...urlBase64ToBytes(KEY)]).toEqual([...KEY_BYTES]));
});

describe('enablePush', () => {
	it('asks permission first, fetches the key, subscribes and registers the device', async () => {
		const { env, manager, requestPermission, local } = envOf();
		const order: string[] = [];
		requestPermission.mockImplementation(async () => (order.push('permission'), 'granted' as const));
		const api = fakeApi({
			'GET /api/push/vapid-key': () => (order.push('key'), { publicKey: KEY }),
			'POST /api/push/subscriptions': (body: unknown) => (order.push('post'), { id: 7, echo: body })
		});
		const result = await enablePush({ api, env, user: 5 });
		expect(result).toEqual({ ok: true, id: 7 });
		expect(order).toEqual(['permission', 'key', 'post']);
		const opts = manager.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
		expect(opts.userVisibleOnly).toBe(true);
		expect([...opts.applicationServerKey]).toEqual([...KEY_BYTES]);
		expect(api).toHaveBeenLastCalledWith('/api/push/subscriptions', {
			method: 'POST',
			body: { endpoint: 'https://push.example/s/1', keys: { p256dh: 'P', auth: 'A' }, label: 'Browser on Linux' }
		});
		expect(local().getItem(deviceIdKey(5))).toBe('7');
	});
	it('reuses a subscription this browser already has', async () => {
		const existing = subscription('https://push.example/s/old');
		const { env, manager } = envOf({ sub: existing });
		const api = fakeApi({ 'GET /api/push/vapid-key': { publicKey: KEY }, 'POST /api/push/subscriptions': { id: 2 } });
		await enablePush({ api, env, user: 1 });
		expect(manager.subscribe).not.toHaveBeenCalled();
	});
	it('reports a denied or dismissed permission without calling the server', async () => {
		for (const request of ['denied', 'default'] as const) {
			const { env } = envOf({ request });
			const api = fakeApi({});
			expect(await enablePush({ api, env, user: 1 })).toEqual({ ok: false, reason: 'denied' });
			expect(api).not.toHaveBeenCalled();
		}
	});
	it('does nothing where push is not supported', async () => {
		const { env, requestPermission } = envOf({ isShell: () => true });
		expect(await enablePush({ api: fakeApi({}), env, user: 1 })).toEqual({ ok: false, reason: 'shell' });
		expect(requestPermission).not.toHaveBeenCalled();
	});
	it('says the server cannot send push (503)', async () => {
		const { env } = envOf();
		const api = fakeApi({ 'GET /api/push/vapid-key': new ApiError(503, JSON.stringify({ error: 'push_unavailable', message: 'x' })) });
		expect(await enablePush({ api, env, user: 1 })).toEqual({ ok: false, reason: 'serverUnavailable' });
	});
	it('reports too many devices and unsubscribes a fresh subscription the server did not accept', async () => {
		const { env, state } = envOf();
		const api = fakeApi({ 'GET /api/push/vapid-key': { publicKey: KEY }, 'POST /api/push/subscriptions': new ApiError(409, JSON.stringify({ error: 'too_many_subscriptions', message: 'x' })) });
		expect(await enablePush({ api, env, user: 1 })).toEqual({ ok: false, reason: 'tooMany' });
		expect(state.sub?.unsubscribe).toHaveBeenCalled();
	});
	it('reports a failing subscribe', async () => {
		const { env, manager } = envOf();
		manager.subscribe.mockRejectedValue(new DOMException('x', 'AbortError'));
		expect(await enablePush({ api: fakeApi({ 'GET /api/push/vapid-key': { publicKey: KEY } }), env, user: 1 })).toEqual({ ok: false, reason: 'failed' });
	});
});

describe('disablePush', () => {
	it('deletes on the server, unsubscribes and forgets the id', async () => {
		const sub = subscription();
		const { env, local } = envOf({ sub });
		local().setItem(deviceIdKey(5), '7');
		const api = fakeApi({ 'DELETE /api/push/subscriptions/7': undefined });
		await disablePush({ api, env, user: 5 });
		expect(api).toHaveBeenCalledWith('/api/push/subscriptions/7', { method: 'DELETE' });
		expect(sub.unsubscribe).toHaveBeenCalled();
		expect(local().getItem(deviceIdKey(5))).toBeNull();
	});
	it('still unsubscribes when the server already forgot the device (404)', async () => {
		const sub = subscription();
		const { env, local } = envOf({ sub });
		local().setItem(deviceIdKey(5), '7');
		await disablePush({ api: fakeApi({}), env, user: 5 });
		expect(sub.unsubscribe).toHaveBeenCalled();
		expect(local().getItem(deviceIdKey(5))).toBeNull();
	});
	it('keeps the id when the server cannot be reached, so it can be retried', async () => {
		const { env, local } = envOf({ sub: subscription() });
		local().setItem(deviceIdKey(5), '7');
		const api = fakeApi({ 'DELETE /api/push/subscriptions/7': new TypeError('offline') });
		await expect(disablePush({ api, env, user: 5 })).rejects.toThrow();
		expect(local().getItem(deviceIdKey(5))).toBe('7');
	});
});

describe('listDevices', () => {
	it('marks this device by the remembered id', async () => {
		const { env, local } = envOf();
		local().setItem(deviceIdKey(5), '2');
		const api = fakeApi({
			'GET /api/push/subscriptions': { subscriptions: [{ id: 1, label: 'A', createdAt: 'x', lastSuccessAt: null }, { id: 2, label: 'B', createdAt: 'y', lastSuccessAt: 'z', extra: 1 }, { nope: true }] }
		});
		expect(await listDevices({ api, env, user: 5 })).toEqual([
			{ id: 1, label: 'A', createdAt: 'x', lastSuccessAt: null, current: false },
			{ id: 2, label: 'B', createdAt: 'y', lastSuccessAt: 'z', current: true }
		]);
	});
	it('is empty for an odd answer', async () => {
		expect(await listDevices({ api: fakeApi({ 'GET /api/push/subscriptions': 'x' }), env: envOf().env, user: 1 })).toEqual([]);
	});
});

describe('removeDevice', () => {
	it('removing another device only deletes it on the server', async () => {
		const sub = subscription();
		const { env, local } = envOf({ sub });
		local().setItem(deviceIdKey(5), '2');
		const api = fakeApi({ 'DELETE /api/push/subscriptions/1': undefined });
		await removeDevice({ api, env, user: 5 }, 1);
		expect(sub.unsubscribe).not.toHaveBeenCalled();
		expect(local().getItem(deviceIdKey(5))).toBe('2');
	});
	it('removing this device also unsubscribes it', async () => {
		const sub = subscription();
		const { env, local } = envOf({ sub });
		local().setItem(deviceIdKey(5), '2');
		await removeDevice({ api: fakeApi({ 'DELETE /api/push/subscriptions/2': undefined }), env, user: 5 }, 2);
		expect(sub.unsubscribe).toHaveBeenCalled();
		expect(local().getItem(deviceIdKey(5))).toBeNull();
	});
});

describe('forgetThisDevice (sign-out)', () => {
	it('fires the DELETE synchronously (the token is still there) and never throws', async () => {
		const sub = subscription();
		const { env, local } = envOf({ sub });
		local().setItem(deviceIdKey(5), '7');
		const api = fakeApi({ 'DELETE /api/push/subscriptions/7': new TypeError('offline') });
		expect(() => forgetThisDevice({ api, env, user: 5 })).not.toThrow();
		expect(api).toHaveBeenCalledWith('/api/push/subscriptions/7', { method: 'DELETE' });
		await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalled());
		expect(local().getItem(deviceIdKey(5))).toBeNull();
	});
	it('does nothing for a device that never enabled push, or in the shell', () => {
		const api = fakeApi({});
		forgetThisDevice({ api, env: envOf().env, user: 5 });
		const shell = envOf({ isShell: () => true });
		shell.local().setItem(deviceIdKey(5), '7');
		forgetThisDevice({ api, env: shell.env, user: 5 });
		expect(api).not.toHaveBeenCalled();
	});
});
