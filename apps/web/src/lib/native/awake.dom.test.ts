import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepAwake } from './awake';

const win = window as unknown as { Capacitor?: unknown };
const nav = navigator as unknown as { wakeLock?: unknown };

afterEach(() => {
	delete win.Capacitor;
	delete nav.wakeLock;
});

describe('keepAwake in a normal browser without the Wake Lock API', () => {
	it('does nothing and its release is harmless', () => {
		const release = keepAwake();
		expect(() => release()).not.toThrow();
	});
});

describe('keepAwake with the Screen Wake Lock API', () => {
	it('requests a screen lock and releases it', async () => {
		const sentinel = { release: vi.fn(async () => undefined), addEventListener: vi.fn() };
		const request = vi.fn(async () => sentinel);
		nav.wakeLock = { request };
		const release = keepAwake();
		await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
		release();
		await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
	});

	it('a refusal (battery saver, hidden tab) is swallowed', async () => {
		nav.wakeLock = { request: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };
		const release = keepAwake();
		await Promise.resolve();
		expect(() => release()).not.toThrow();
	});
});

describe('keepAwake in the shell', () => {
	it('is on while anyone holds it and off after the last release', () => {
		const calls: boolean[] = [];
		win.Capacitor = {
			isNativePlatform: () => true,
			Plugins: { QinqinShell: { keepAwake: async ({ on }: { on: boolean }) => void calls.push(on) } }
		};
		const a = keepAwake();
		const b = keepAwake();
		a();
		a();
		expect(calls).toEqual([true]);
		b();
		expect(calls).toEqual([true, false]);
	});
});
