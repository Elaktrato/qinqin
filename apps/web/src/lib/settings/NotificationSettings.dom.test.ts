import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import { testContext, memoryStorage, type TestContext } from '$lib/testing/context';
import { defaultReminderSettings, type ReminderSettings } from '$lib/reminders/settings';
import type { ReminderPlan } from '$lib/reminders/plan';
import { fakePort } from '$lib/reminders/device/port';
import { deviceIdKey, type PushEnv } from '$lib/pwa/push';
import NotificationSettings from './NotificationSettings.svelte';

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const plan = (over: Partial<ReminderPlan['available']> = {}): ReminderPlan => ({
	generatedAt: '',
	zone: 'UTC',
	enabled: false,
	channels: { email: false, push: false, device: false },
	available: { email: false, push: false, ...over },
	slots: []
});

function pushEnv(over: Partial<PushEnv> = {}, permission: NotificationPermission = 'default') {
	const local = memoryStorage();
	const sub = { endpoint: 'https://p/1', toJSON: () => ({ endpoint: 'https://p/1', keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: vi.fn(async () => true) };
	const state: { sub: typeof sub | null } = { sub: null };
	const requestPermission = vi.fn(async () => {
		permission = 'granted';
		return permission;
	});
	const env: PushEnv = {
		isShell: () => false,
		isSecureContext: true,
		hasServiceWorker: true,
		hasPushManager: true,
		hasNotification: true,
		standalone: false,
		ios: false,
		permission: () => permission,
		requestPermission,
		registration: async () => ({ pushManager: { getSubscription: async () => state.sub, subscribe: async () => (state.sub = sub) } }),
		local: () => local,
		deviceLabel: () => 'Browser on Linux',
		...over
	};
	return { env, local, requestPermission, sub, state };
}

type Setup = {
	settings?: ReminderSettings;
	newer?: boolean;
	available?: Partial<ReminderPlan['available']>;
	env?: PushEnv;
	shell?: boolean;
	port?: ReturnType<typeof fakePort>;
	routes?: Record<string, unknown>;
};

function setup(o: Setup = {}) {
	const saved: unknown[] = [];
	const save = vi.fn(async (change: unknown) => {
		saved.push(change);
		return defaultReminderSettings();
	});
	const routes = Object.fromEntries(
		Object.entries(o.routes ?? {}).map(([key, value]) => [
			key,
			() => {
				if (value instanceof Error) throw value;
				return typeof value === 'function' ? (value as () => unknown)() : value;
			}
		])
	);
	ctx = testContext({ routes });
	const api = ctx.deps.api as unknown as ReturnType<typeof vi.fn>;
	render(NotificationSettings, {
		context: ctx.context,
		props: {
			load: async () => ({ settings: o.settings ?? defaultReminderSettings(), newer: o.newer ?? false }),
			save: save as never,
			loadPlan: async () => plan(o.available),
			env: o.env ?? pushEnv().env,
			shell: o.shell ?? false,
			port: o.port ?? fakePort('prompt')
		}
	});
	return { save, saved, api };
}

const ready = () => screen.findByRole('switch', { name: 'Send me reminders' });

describe('NotificationSettings', () => {
	it('starts off by default and explains that nothing is sent when nothing is due', async () => {
		setup();
		expect(((await ready()) as HTMLInputElement).checked).toBe(false);
		expect(screen.getByText(/nothing is sent when nothing is due/)).toBeTruthy();
		expect(screen.getByText(/counts only/)).toBeTruthy();
	});

	it('writes the master switch to the keyed row', async () => {
		const { save } = setup();
		await fireEvent.click(await ready());
		await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true }));
		expect(await screen.findByText('Saved.')).toBeTruthy();
	});

	it('writes one kind at a time', async () => {
		const { save } = setup();
		await ready();
		await fireEvent.click(screen.getByRole('switch', { name: 'My daily goal' }));
		await waitFor(() => expect(save).toHaveBeenCalledWith({ kinds: { goal: false } }));
	});

	it('edits, adds and removes times (one to three), saving the cleaned list', async () => {
		const { save } = setup({ settings: { ...defaultReminderSettings(), times: ['18:00'] } });
		await ready();
		expect(screen.queryByRole('button', { name: /Remove time/ })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
		await waitFor(() => expect(save).toHaveBeenLastCalledWith({ times: ['09:00', '18:00'] }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
		expect(screen.queryByRole('button', { name: 'Add a time' })).toBeNull();
		const first = screen.getByLabelText('Time 1');
		await fireEvent.input(first, { target: { value: '07:30' } });
		await fireEvent.change(first);
		await waitFor(() => expect(save).toHaveBeenLastCalledWith({ times: expect.arrayContaining(['07:30']) }));
		await fireEvent.click(screen.getAllByRole('button', { name: /Remove time/ })[0]);
		await waitFor(() => expect(screen.getAllByLabelText(/^Time \d$/)).toHaveLength(2));
	});

	it('does not save a repeated time', async () => {
		const { save } = setup({ settings: { ...defaultReminderSettings(), times: ['09:00', '18:00'] } });
		await ready();
		const second = screen.getByLabelText('Time 2');
		await fireEvent.input(second, { target: { value: '09:00' } });
		await fireEvent.change(second);
		expect(save).not.toHaveBeenCalled();
	});

	it('switches quiet hours off (null) and on (the default), and edits the ends', async () => {
		const { save } = setup();
		await ready();
		await fireEvent.input(screen.getByLabelText('From'), { target: { value: '23:00' } });
		await fireEvent.change(screen.getByLabelText('From'));
		await waitFor(() => expect(save).toHaveBeenLastCalledWith({ quiet: { start: '23:00', end: '08:00' } }));
		await fireEvent.click(screen.getByRole('switch', { name: 'Use quiet hours' }));
		await waitFor(() => expect(save).toHaveBeenLastCalledWith({ quiet: null }));
		expect(screen.queryByLabelText('From')).toBeNull();
		await fireEvent.click(screen.getByRole('switch', { name: 'Use quiet hours' }));
		await waitFor(() => expect(save).toHaveBeenLastCalledWith({ quiet: { start: '22:00', end: '08:00' } }));
	});

	it('email is disabled with an explanation unless the plan says it is available', async () => {
		setup({ available: { email: false } });
		const email = await screen.findByRole('switch', { name: 'Email' });
		await waitFor(() => expect((email as HTMLInputElement).disabled).toBe(true));
		expect(screen.getByText(/Email is not available/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull();
	});

	it('email is usable when available, and the test reports the coded errors as plain messages', async () => {
		const { api } = setup({
			settings: { ...defaultReminderSettings(), enabled: true, channels: { email: true, push: false, device: false } },
			available: { email: true },
			routes: { 'POST /api/reminders/test': new ApiError(409, JSON.stringify({ error: 'email_unverified', message: 'x' })) }
		});
		await fireEvent.click(await screen.findByRole('button', { name: 'Send test' }));
		expect(await screen.findByText('Confirm your email address first (Account settings).')).toBeTruthy();
		expect(api).toHaveBeenCalledWith('/api/reminders/test', { method: 'POST', body: { channel: 'email' } });
	});

	it('a successful test says so; a rate limit says one a minute', async () => {
		let answer: unknown = undefined;
		setup({
			settings: { ...defaultReminderSettings(), channels: { email: true, push: false, device: false } },
			available: { email: true },
			routes: { 'POST /api/reminders/test': () => { if (answer instanceof Error) throw answer; return answer; } }
		});
		const button = await screen.findByRole('button', { name: 'Send test' });
		await fireEvent.click(button);
		expect(await screen.findByText('Test sent.')).toBeTruthy();
		answer = new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'x' }));
		await fireEvent.click(button);
		expect(await screen.findByText('Only one test a minute. Try again shortly.')).toBeTruthy();
	});

	describe('web push', () => {
		it('turning it on asks the permission from the click, subscribes, registers and saves the channel', async () => {
			const p = pushEnv();
			const { save, api } = setup({
				env: p.env,
				available: { push: true },
				routes: {
					'GET /api/push/subscriptions': { subscriptions: [] },
					'GET /api/push/vapid-key': { publicKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
					'POST /api/push/subscriptions': { id: 4 }
				}
			});
			await fireEvent.click(await screen.findByRole('switch', { name: 'Web push' }));
			await waitFor(() => expect(save).toHaveBeenCalledWith({ channels: { push: true } }));
			expect(p.requestPermission).toHaveBeenCalled();
			expect(api).toHaveBeenCalledWith('/api/push/subscriptions', expect.objectContaining({ method: 'POST' }));
			expect(p.local.getItem(deviceIdKey(ctx.session.user))).toBe('4');
		});

		it('a denied permission is explained and nothing is saved', async () => {
			const p = pushEnv();
			p.requestPermission.mockResolvedValue('denied');
			const { save } = setup({ env: p.env, available: { push: true }, routes: { 'GET /api/push/subscriptions': { subscriptions: [] } } });
			await fireEvent.click(await screen.findByRole('switch', { name: 'Web push' }));
			expect(await screen.findByText(/Notifications are blocked for this site/)).toBeTruthy();
			expect(save).not.toHaveBeenCalled();
		});

		it('says it needs HTTPS in an insecure context, and the home screen on iOS', async () => {
			setup({ env: pushEnv({ isSecureContext: false }).env });
			expect(await screen.findByText(/needs a secure \(HTTPS\) address/)).toBeTruthy();
			cleanup();
			setup({ env: pushEnv({ ios: true, standalone: false }).env });
			expect(await screen.findByText(/add qinqin to the home screen/)).toBeTruthy();
		});

		it('is not offered in the Android shell, which offers device notifications instead', async () => {
			setup({ shell: true, env: pushEnv({ isShell: () => true }).env });
			await ready();
			expect(screen.queryByRole('switch', { name: 'Web push' })).toBeNull();
			expect(screen.getByRole('switch', { name: 'Device notifications' })).toBeTruthy();
		});

		it('lists the devices, marks this one and removes one', async () => {
			const p = pushEnv();
			p.local.setItem(deviceIdKey(ctx.session.user), '2');
			const { api } = setup({
				env: p.env,
				available: { push: true },
				settings: { ...defaultReminderSettings(), channels: { email: false, push: true, device: false } },
				routes: {
					'GET /api/push/subscriptions': { subscriptions: [{ id: 1, label: 'Phone', createdAt: 'x', lastSuccessAt: null }, { id: 2, label: 'Laptop', createdAt: 'x', lastSuccessAt: null }] },
					'DELETE /api/push/subscriptions/1': undefined
				}
			});
			expect(await screen.findByText('Phone')).toBeTruthy();
			expect(screen.getByText('(This device)')).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
			await waitFor(() => expect(api).toHaveBeenCalledWith('/api/push/subscriptions/1', { method: 'DELETE' }));
		});
	});

	describe('device notifications (Android shell)', () => {
		it('asks the permission through the port from the click, then saves', async () => {
			const port = fakePort('prompt');
			const { save } = setup({ shell: true, port });
			await fireEvent.click(await screen.findByRole('switch', { name: 'Device notifications' }));
			await waitFor(() => expect(save).toHaveBeenCalledWith({ channels: { device: true } }));
			expect(port.calls).toContain('requestPermission');
		});

		it('a refused permission is explained and not saved', async () => {
			const port = fakePort('prompt');
			port.requestResult = 'denied';
			const { save } = setup({ shell: true, port });
			await fireEvent.click(await screen.findByRole('switch', { name: 'Device notifications' }));
			expect(await screen.findByText(/blocked for the app/)).toBeTruthy();
			expect(save).not.toHaveBeenCalled();
		});

		it('is not shown in a normal browser', async () => {
			setup({ shell: false });
			await ready();
			expect(screen.queryByRole('switch', { name: 'Device notifications' })).toBeNull();
		});
	});

	it('offers Retry when a save fails', async () => {
		const { save } = setup();
		save.mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(await ready());
		expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		expect(save).toHaveBeenLastCalledWith({ enabled: true });
	});

	it('a row from a newer version is read-only with a note', async () => {
		const { save } = setup({ newer: true });
		const toggle = await ready();
		expect((toggle as HTMLInputElement).disabled).toBe(true);
		expect(screen.getByText(/saved by a newer version/)).toBeTruthy();
		await fireEvent.click(toggle);
		expect(save).not.toHaveBeenCalled();
	});

	it('says so when the settings cannot be loaded', async () => {
		render(NotificationSettings, { context: ctx.context, props: { load: async () => { throw new Error('x'); }, loadPlan: async () => plan(), env: pushEnv().env, shell: false } });
		expect((await screen.findByRole('alert')).textContent).toBe('Could not load your reminder settings.');
	});
});
