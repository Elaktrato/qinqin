import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DwellCounter, HOVER_DWELL_MS } from './dwell';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('DwellCounter', () => {
	it('waits one second', () => {
		expect(HOVER_DWELL_MS).toBe(1000);
	});

	it('a popup closed before the dwell counts nothing', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		vi.advanceTimersByTime(999);
		d.closed();
		vi.advanceTimersByTime(5000);
		expect(onCount).not.toHaveBeenCalled();
	});

	it('passing over three words counts nothing', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		for (const id of [1, 2, 3]) {
			d.shown(id);
			vi.advanceTimersByTime(300);
		}
		d.closed();
		vi.advanceTimersByTime(5000);
		expect(onCount).not.toHaveBeenCalled();
	});

	it('resting one second counts once', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		vi.advanceTimersByTime(1000);
		expect(onCount).toHaveBeenCalledExactlyOnceWith(7);
		vi.advanceTimersByTime(5000);
		d.entered();
		expect(onCount).toHaveBeenCalledTimes(1);
	});

	it('entering the popup counts at once, and not again at one second', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		vi.advanceTimersByTime(200);
		d.entered();
		expect(onCount).toHaveBeenCalledExactlyOnceWith(7);
		vi.advanceTimersByTime(1000);
		d.entered();
		expect(onCount).toHaveBeenCalledTimes(1);
	});

	it('a new shown restarts the dwell for the new entry', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		vi.advanceTimersByTime(800);
		d.shown(8);
		vi.advanceTimersByTime(800);
		expect(onCount).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(onCount).toHaveBeenCalledExactlyOnceWith(8);
	});

	it('the same entry shown again after a count counts again (the merge dedupes)', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		d.entered();
		d.closed();
		d.shown(7);
		d.entered();
		expect(onCount).toHaveBeenCalledTimes(2);
	});

	it('a popup with no result never counts', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(null);
		vi.advanceTimersByTime(2000);
		d.entered();
		expect(onCount).not.toHaveBeenCalled();
	});

	it('entered after closed counts nothing', () => {
		const onCount = vi.fn();
		const d = new DwellCounter(onCount);
		d.shown(7);
		d.closed();
		d.entered();
		vi.advanceTimersByTime(2000);
		expect(onCount).not.toHaveBeenCalled();
	});
});
