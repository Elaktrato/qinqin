// The emulator driver's recovery from an unplanned activity relaunch (the flake of #35/#37): counting "App destroyed"
// lines of the shell's logcat, and retrying a step once after the page's DevTools target died with a relaunch.
import { describe, expect, it, vi } from 'vitest';
import { RelaunchCounter, looksDead, withRecovery } from './recover.mjs';

describe('RelaunchCounter', () => {
	it('counts the Capacitor "App destroyed" lines and nothing else', () => {
		const c = new RelaunchCounter();
		c.feed(
			[
				'11-26 09:37:15.490 D/Capacitor( 4675): App destroyed',
				'11-26 09:37:15.489 D/Capacitor( 4675): App stopped',
				'11-26 09:37:15.490 D/Capacitor/AppPlugin( 4675): App destroyed',
				'11-26 09:37:16.000 D/OtherTag( 1): App destroyed',
				'11-26 09:37:17.000 D/Capacitor(12345): App destroyed',
				''
			].join('\n')
		);
		expect(c.count).toBe(2);
	});

	it('joins a line split across two chunks', () => {
		const c = new RelaunchCounter();
		c.feed('11-26 09:37:15.490 D/Capacitor( 4675): App dest');
		expect(c.count).toBe(0);
		c.feed('royed\n');
		expect(c.count).toBe(1);
	});

	it('handles Windows line ends and calls every listener once per relaunch', () => {
		const c = new RelaunchCounter();
		const a = vi.fn();
		const b = vi.fn();
		c.onRelaunch(a);
		c.onRelaunch(b);
		c.feed('x D/Capacitor( 1): App destroyed\r\ny D/Capacitor( 1): App destroyed\r\n');
		expect(a).toHaveBeenCalledTimes(2);
		expect(b).toHaveBeenCalledTimes(2);
		expect(c.count).toBe(2);
	});

	it('a listener that throws does not stop the counting', () => {
		const c = new RelaunchCounter();
		c.onRelaunch(() => {
			throw new Error('boom');
		});
		c.feed('x D/Capacitor( 1): App destroyed\n');
		expect(c.count).toBe(1);
	});
});

describe('looksDead', () => {
	it('recognises a closed or silent DevTools target and a timeout', () => {
		expect(looksDead(new Error('DevTools socket closed'))).toBe(true);
		expect(looksDead(new Error('Runtime.evaluate: no answer in 60 s'))).toBe(true);
		expect(looksDead(new Error('timeout (60000 ms) waiting for the worker ready: Runtime.evaluate: no answer in 60 s'))).toBe(true);
	});
	it('does not take an ordinary failure for a dead page', () => {
		expect(looksDead(new Error('unexpected notes: x'))).toBe(false);
		expect(looksDead(new Error('page exception: TypeError: x'))).toBe(false);
		expect(looksDead(undefined)).toBe(false);
	});
});

describe('withRecovery', () => {
	const dead = () => new Error('Runtime.evaluate: no answer in 60 s');

	it('returns the result and does not recover when the step passes', async () => {
		const counter = new RelaunchCounter();
		const recover = vi.fn();
		const r = await withRecovery(async () => 'ok', { counter, recover });
		expect(r).toEqual({ value: 'ok', retried: false });
		expect(recover).not.toHaveBeenCalled();
	});

	it('runs the step again once, after recover(), when the page died together with a relaunch', async () => {
		const counter = new RelaunchCounter();
		const order = [];
		let calls = 0;
		const r = await withRecovery(
			async () => {
				order.push(`run${++calls}`);
				if (calls === 1) {
					counter.feed('x D/Capacitor( 1): App destroyed\n');
					throw dead();
				}
				return 'second';
			},
			{
				counter,
				recover: async () => {
					order.push('recover');
				}
			}
		);
		expect(r).toEqual({ value: 'second', retried: true });
		expect(order).toEqual(['run1', 'recover', 'run2']);
	});

	it('a second failure after the retry is thrown, not retried again', async () => {
		const counter = new RelaunchCounter();
		const fn = vi.fn(async () => {
			counter.feed('x D/Capacitor( 1): App destroyed\n');
			throw dead();
		});
		const recover = vi.fn(async () => {});
		await expect(withRecovery(fn, { counter, recover })).rejects.toThrow(/no answer/);
		expect(fn).toHaveBeenCalledTimes(2);
		expect(recover).toHaveBeenCalledTimes(1);
	});

	it('does not retry a dead page without a relaunch (the step stays a real failure)', async () => {
		const counter = new RelaunchCounter();
		const fn = vi.fn(async () => {
			throw dead();
		});
		await expect(withRecovery(fn, { counter, recover: vi.fn() })).rejects.toThrow(/no answer/);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('does not retry an ordinary failure even when a relaunch happened', async () => {
		const counter = new RelaunchCounter();
		const fn = vi.fn(async () => {
			counter.feed('x D/Capacitor( 1): App destroyed\n');
			throw new Error('unexpected notes: x');
		});
		await expect(withRecovery(fn, { counter, recover: vi.fn() })).rejects.toThrow(/unexpected notes/);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('is off when disabled', async () => {
		const counter = new RelaunchCounter();
		const fn = vi.fn(async () => {
			counter.feed('x D/Capacitor( 1): App destroyed\n');
			throw dead();
		});
		await expect(withRecovery(fn, { counter, recover: vi.fn(), enabled: false })).rejects.toThrow(/no answer/);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('a relaunch that happened before the step does not count', async () => {
		const counter = new RelaunchCounter();
		counter.feed('x D/Capacitor( 1): App destroyed\n');
		const fn = vi.fn(async () => {
			throw dead();
		});
		await expect(withRecovery(fn, { counter, recover: vi.fn() })).rejects.toThrow(/no answer/);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('when recover() itself fails, that failure is thrown', async () => {
		const counter = new RelaunchCounter();
		const fn = async () => {
			counter.feed('x D/Capacitor( 1): App destroyed\n');
			throw dead();
		};
		await expect(
			withRecovery(fn, {
				counter,
				recover: async () => {
					throw new Error('no WebView page');
				}
			})
		).rejects.toThrow(/no WebView page/);
	});
});
