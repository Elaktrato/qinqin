import { describe, expect, it } from 'vitest';

import type { Dataset } from './dataset';
import { runOptimizer, runPreview } from './optimizerClient';

class FakeWorker {
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	posted: unknown[] = [];
	terminated = false;
	postMessage(m: unknown): void {
		this.posted.push(m);
	}
	terminate(): void {
		this.terminated = true;
	}
	emit(data: unknown): void {
		this.onmessage?.({ data } as MessageEvent);
	}
}

const data: Dataset = { cards: [], labelled: 0 };
const make = (w: FakeWorker) => () => w as unknown as Worker;

describe('runOptimizer', () => {
	it('forwards progress as a fraction and resolves the result', async () => {
		const w = new FakeWorker();
		const fractions: number[] = [];
		const p = runOptimizer(data, { createWorker: make(w), onProgress: (f) => fractions.push(f) });
		expect(w.posted).toEqual([{ type: 'run', data }]);
		w.emit({ type: 'progress', done: 1, total: 4 });
		const result = { ok: false, reason: 'too-few', labelled: 0, needed: 400 } as const;
		w.emit({ type: 'result', result });
		await expect(p).resolves.toEqual(result);
		expect(fractions).toEqual([0.25]);
		expect(w.terminated).toBe(true);
	});

	it('sends the weights to compare with', () => {
		const w = new FakeWorker();
		void runOptimizer(data, { createWorker: make(w), current: [1, 2, 3] });
		expect(w.posted).toEqual([{ type: 'run', data, current: [1, 2, 3] }]);
	});

	it('rejects on an error message', async () => {
		const w = new FakeWorker();
		const p = runOptimizer(data, { createWorker: make(w) });
		w.emit({ type: 'error', message: 'boom' });
		await expect(p).rejects.toThrow('boom');
		expect(w.terminated).toBe(true);
	});

	it('rejects when the worker cannot be created', async () => {
		await expect(
			runOptimizer(data, {
				createWorker: () => {
					throw new Error('no workers');
				}
			})
		).rejects.toThrow('The optimizer could not start in this browser.');
	});

	it('rejects when the worker throws', async () => {
		const w = new FakeWorker();
		const p = runOptimizer(data, { createWorker: make(w) });
		w.onerror?.({ message: 'x' } as ErrorEvent);
		await expect(p).rejects.toThrow('The optimizer stopped unexpectedly.');
	});

	it('terminates and resolves stopped on abort', async () => {
		const w = new FakeWorker();
		const ctl = new AbortController();
		const p = runOptimizer(data, { createWorker: make(w), signal: ctl.signal });
		ctl.abort();
		await expect(p).resolves.toEqual({ ok: false, reason: 'stopped', labelled: 0 });
		expect(w.terminated).toBe(true);
	});
});

describe('runPreview', () => {
	const input = { cards: [], reviews: [], from: [1], to: [2], now: new Date('2026-06-01T00:00:00Z') };
	const preview = {
		dueNow: [1, 2],
		due7: [1, 2],
		due30: [1, 2],
		medianIntervalDays: [1, 2],
		moved: [],
		surge: false
	};

	it('posts the input with the time as a number and resolves the preview', async () => {
		const w = new FakeWorker();
		const p = runPreview(input, { createWorker: make(w) });
		expect(w.posted).toEqual([
			{ type: 'preview', cards: [], reviews: [], from: [1], to: [2], now: input.now.getTime() }
		]);
		w.emit({ type: 'preview', preview });
		await expect(p).resolves.toEqual(preview);
		expect(w.terminated).toBe(true);
	});

	it('rejects on an error and when the worker cannot start', async () => {
		const w = new FakeWorker();
		const p = runPreview(input, { createWorker: make(w) });
		w.emit({ type: 'error', message: 'nope' });
		await expect(p).rejects.toThrow('nope');
		await expect(
			runPreview(input, {
				createWorker: () => {
					throw new Error('x');
				}
			})
		).rejects.toThrow('The preview could not start in this browser.');
	});

	it('terminates on abort and never resolves a preview', async () => {
		const w = new FakeWorker();
		const ctl = new AbortController();
		const p = runPreview(input, { createWorker: make(w), signal: ctl.signal });
		ctl.abort();
		await expect(p).rejects.toThrow('cancelled');
		expect(w.terminated).toBe(true);
	});
});
