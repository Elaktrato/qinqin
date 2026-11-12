import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionSaver } from './positionSaver';

describe('PositionSaver', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('saves only the last position after the delay', () => {
		const save = vi.fn(() => Promise.resolve());
		const saver = new PositionSaver(save, 1000);
		saver.schedule(1, '0:3');
		vi.advanceTimersByTime(500);
		saver.schedule(1, '0:4');
		vi.advanceTimersByTime(999);
		expect(save).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(save).toHaveBeenCalledExactlyOnceWith(1, '0:4');
	});

	it('skips the position already stored', () => {
		const save = vi.fn(() => Promise.resolve());
		const saver = new PositionSaver(save, 1000);
		saver.reset('2:7');
		saver.schedule(1, '2:7');
		vi.advanceTimersByTime(2000);
		expect(save).not.toHaveBeenCalled();
		saver.schedule(1, '2:8');
		saver.schedule(1, '2:7');
		vi.advanceTimersByTime(2000);
		expect(save).not.toHaveBeenCalled();
	});

	it('flushes a pending save at once and ignores failures', async () => {
		const save = vi.fn(() => Promise.reject(new Error('offline')));
		const saver = new PositionSaver(save, 1000);
		saver.schedule(3, '1:0');
		saver.flush();
		expect(save).toHaveBeenCalledExactlyOnceWith(3, '1:0');
		await Promise.resolve();
		saver.flush();
		vi.advanceTimersByTime(2000);
		expect(save).toHaveBeenCalledTimes(1);
	});
});
