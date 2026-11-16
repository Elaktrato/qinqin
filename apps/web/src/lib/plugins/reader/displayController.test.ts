import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDisplayController, SAVE_DELAY_MS } from './displayController';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(settings: Record<string, unknown> | null = null, save = vi.fn(async () => {}), onError = vi.fn()) {
	const c = createDisplayController({ settings: () => settings, localFurigana: () => null, save, onError });
	return { c, save, onError };
}

describe('createDisplayController', () => {
	it('starts from the workspace settings', () => {
		const { c } = make({ reader: { readings: 'smart', smartThreshold: 60 } });
		expect(c.display.readings).toBe('smart');
		expect(c.display.smartThreshold).toBe(60);
	});

	it('applies a change at once and saves it once after the delay', async () => {
		const { c, save } = make();
		c.change({ readings: 'always' });
		expect(c.display.readings).toBe('always');
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith({ reader: { version: 1, readings: 'always' } });
	});

	it('merges quick changes into one patch', async () => {
		const { c, save } = make({ reader: { font: 'serif', keep: 1 } });
		c.change({ smartThreshold: 50 });
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
		c.change({ smartThreshold: 55 });
		c.change({ rubyScale: 0.75 });
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith({ reader: { font: 'serif', keep: 1, version: 1, smartThreshold: 55, rubyScale: 0.75 } });
	});

	it('a failed save keeps the local state and reports', async () => {
		const save = vi.fn(async () => {
			throw new Error('offline');
		});
		const { c, onError } = make(null, save);
		c.change({ font: 'kai' });
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(c.display.font).toBe('kai');
	});

	it('flush saves a pending change immediately', async () => {
		const { c, save } = make();
		c.change({ bookRuby: false });
		await c.flush();
		expect(save).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('adopts changed workspace settings only while nothing is pending', () => {
		let settings: Record<string, unknown> | null = null;
		const c = createDisplayController({ settings: () => settings, localFurigana: () => null, save: vi.fn(async () => {}), onError: vi.fn() });
		settings = { reader: { readings: 'always' } };
		c.adopt();
		expect(c.display.readings).toBe('always');
		c.change({ font: 'sans' });
		settings = { reader: { readings: 'never' } };
		c.adopt();
		expect(c.display.readings).toBe('always');
		expect(c.display.font).toBe('sans');
	});

	it('does not adopt while a save is in flight, and keeps the choice when it fails', async () => {
		let settings: Record<string, unknown> | null = null;
		let reject: (e: Error) => void = () => {};
		const save = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
		const onError = vi.fn();
		const c = createDisplayController({ settings: () => settings, localFurigana: () => null, save, onError });
		c.change({ readings: 'smart' });
		await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
		settings = { reader: { readings: 'never' } };
		c.adopt();
		expect(c.display.readings).toBe('smart');
		reject(new Error('offline'));
		await vi.advanceTimersByTimeAsync(0);
		expect(onError).toHaveBeenCalledTimes(1);
		c.adopt();
		expect(c.display.readings).toBe('smart');
	});
});
