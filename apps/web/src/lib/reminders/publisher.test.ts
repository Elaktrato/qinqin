import { describe, expect, it, vi } from 'vitest';
import { manualTimers } from '$lib/testing/context';
import { createFactsPublisher } from './publisher';

function setup(over: { enabled?: () => Promise<boolean>; publish?: (ws: number) => Promise<void> } = {}) {
	const timers = manualTimers();
	const clock = { ms: 0 };
	const publish = vi.fn(over.publish ?? (async () => undefined));
	const after = vi.fn(async () => undefined);
	const publisher = createFactsPublisher({
		timers,
		now: () => clock.ms,
		enabled: over.enabled ?? (async () => true),
		workspaces: () => [3, 4],
		publish,
		after
	});
	// manualTimers keeps its own clock; advance both.
	const advance = async (ms: number) => {
		clock.ms += ms;
		timers.advance(ms);
		await vi.waitFor(() => undefined);
		await new Promise((r) => setTimeout(r, 0));
	};
	return { publisher, publish, after, advance, clock, timers };
}

describe('createFactsPublisher', () => {
	it('publishes every workspace once, 5 s after the last request, then runs `after`', async () => {
		const { publisher, publish, after, advance } = setup();
		publisher.request();
		await advance(3000);
		publisher.request();
		await advance(3000);
		expect(publish).not.toHaveBeenCalled();
		await advance(2100);
		expect(publish.mock.calls.map((c) => c[0])).toEqual([3, 4]);
		expect(after).toHaveBeenCalledTimes(1);
		expect(after).toHaveBeenCalledWith({ published: true });
	});
	it('runs at most once a minute: a later request waits for the gap', async () => {
		const { publisher, publish, advance } = setup();
		publisher.request();
		await advance(5100);
		expect(publish).toHaveBeenCalledTimes(2);
		publisher.request();
		await advance(5100);
		expect(publish).toHaveBeenCalledTimes(2);
		await advance(55_000);
		expect(publish).toHaveBeenCalledTimes(4);
	});
	it('publishes nothing for an account that has not enabled reminders, but still runs `after` (a cancel)', async () => {
		const { publisher, publish, after, advance } = setup({ enabled: async () => false });
		publisher.request();
		await advance(5100);
		expect(publish).not.toHaveBeenCalled();
		expect(after).toHaveBeenCalledTimes(1);
	});
	it('never throws: a failing workspace is skipped, the rest and `after` still run', async () => {
		const { publisher, publish, after, advance } = setup({
			publish: async (ws) => {
				if (ws === 3) throw new Error('boom');
			}
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		publisher.request();
		await advance(5100);
		expect(publish).toHaveBeenCalledTimes(2);
		expect(after).toHaveBeenCalledTimes(1);
		expect(after).toHaveBeenCalledWith({ published: false });
		warn.mockRestore();
	});
	it('a failing settings read publishes nothing and does not throw', async () => {
		const { publisher, publish, after, advance } = setup({ enabled: async () => Promise.reject(new Error('offline')) });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		publisher.request();
		await advance(5100);
		expect(publish).not.toHaveBeenCalled();
		expect(after).toHaveBeenCalledWith({ published: false });
		warn.mockRestore();
	});
	it('stop cancels a pending run and ignores later requests', async () => {
		const { publisher, publish, advance, timers } = setup();
		publisher.request();
		publisher.stop();
		expect(timers.pending()).toBe(0);
		publisher.request();
		await advance(10_000);
		expect(publish).not.toHaveBeenCalled();
	});
});
