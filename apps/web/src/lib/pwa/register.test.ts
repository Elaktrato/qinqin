import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerRegistration, type RegistrationEnv } from './register.svelte';

class FakeWorker extends EventTarget {
	state = 'installing';
	posted: unknown[] = [];
	postMessage(message: unknown): void {
		this.posted.push(message);
	}
}
class FakeRegistration extends EventTarget {
	waiting: FakeWorker | null = null;
	installing: FakeWorker | null = null;
	update = vi.fn(async () => {});
}
class FakeContainer extends EventTarget {
	controller: object | null = null;
	registration = new FakeRegistration();
	register = vi.fn(async (_url: string, _options?: unknown) => this.registration);
}

function env(container: FakeContainer | undefined, secure = true): RegistrationEnv & { reload: ReturnType<typeof vi.fn> } {
	const reload = vi.fn();
	return {
		isSecureContext: secure,
		serviceWorker: container as unknown as RegistrationEnv['serviceWorker'],
		reload,
		setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('registration', () => {
	it('does nothing in an insecure context (plain-HTTP LAN installs behave as before)', async () => {
		const c = new FakeContainer();
		const r = createWorkerRegistration(env(c, false));
		await r.register();
		expect(c.register).not.toHaveBeenCalled();
		expect(r.updateAvailable).toBe(false);
	});

	it('does nothing without service worker support', async () => {
		const r = createWorkerRegistration(env(undefined));
		await expect(r.register()).resolves.toBeUndefined();
	});

	it('registers /service-worker.js with scope / and no HTTP caching of the script', async () => {
		const c = new FakeContainer();
		await createWorkerRegistration(env(c)).register();
		expect(c.register).toHaveBeenCalledWith('/service-worker.js', { scope: '/', updateViaCache: 'none' });
	});

	it('a first install (no controller) shows no banner', async () => {
		const c = new FakeContainer();
		const r = createWorkerRegistration(env(c));
		await r.register();
		const worker = new FakeWorker();
		c.registration.installing = worker;
		c.registration.dispatchEvent(new Event('updatefound'));
		worker.state = 'installed';
		worker.dispatchEvent(new Event('statechange'));
		expect(r.updateAvailable).toBe(false);
	});

	it('an update installed behind a running worker offers a reload', async () => {
		const c = new FakeContainer();
		c.controller = {};
		const r = createWorkerRegistration(env(c));
		await r.register();
		const worker = new FakeWorker();
		c.registration.installing = worker;
		c.registration.dispatchEvent(new Event('updatefound'));
		expect(r.updateAvailable).toBe(false);
		worker.state = 'installed';
		worker.dispatchEvent(new Event('statechange'));
		expect(r.updateAvailable).toBe(true);
	});

	it('an update already waiting at load offers a reload', async () => {
		const c = new FakeContainer();
		c.controller = {};
		c.registration.waiting = new FakeWorker();
		const r = createWorkerRegistration(env(c));
		await r.register();
		expect(r.updateAvailable).toBe(true);
	});

	it('apply posts skip-waiting and reloads exactly once, however many controllerchange events', async () => {
		const c = new FakeContainer();
		c.controller = {};
		const waiting = new FakeWorker();
		c.registration.waiting = waiting;
		const e = env(c);
		const r = createWorkerRegistration(e);
		await r.register();
		r.apply();
		expect(waiting.posted).toEqual([{ type: 'skip-waiting' }]);
		expect(e.reload).not.toHaveBeenCalled();
		c.dispatchEvent(new Event('controllerchange'));
		c.dispatchEvent(new Event('controllerchange'));
		expect(e.reload).toHaveBeenCalledTimes(1);
	});

	it('a controllerchange nobody asked for (first claim) does not reload nor offer an update', async () => {
		const c = new FakeContainer();
		const e = env(c);
		await createWorkerRegistration(e).register();
		c.dispatchEvent(new Event('controllerchange'));
		expect(e.reload).not.toHaveBeenCalled();
	});

	it('a tab that did not press Reload learns about an update another tab applied', async () => {
		const c = new FakeContainer();
		c.controller = {};
		const e = env(c);
		const r = createWorkerRegistration(e);
		await r.register();
		c.dispatchEvent(new Event('controllerchange')); // another tab sent skip-waiting
		expect(e.reload).not.toHaveBeenCalled(); // never swaps code under an open page by itself
		expect(r.updateAvailable).toBe(true);
		r.apply(); // nothing is waiting any more: Reload just reloads
		expect(e.reload).toHaveBeenCalledTimes(1);
	});

	it('checks for a new worker hourly', async () => {
		const c = new FakeContainer();
		await createWorkerRegistration(env(c)).register();
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(c.registration.update).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(c.registration.update).toHaveBeenCalledTimes(2);
	});

	it('a failed registration is swallowed', async () => {
		const c = new FakeContainer();
		c.register.mockRejectedValue(new Error('SecurityError'));
		const r = createWorkerRegistration(env(c));
		await expect(r.register()).resolves.toBeUndefined();
		expect(r.updateAvailable).toBe(false);
	});
});
