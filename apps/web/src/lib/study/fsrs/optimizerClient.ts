// Starts the optimizer worker and turns its messages into a promise.

import type { Dataset } from './dataset';
import type { OptimizeResult } from './optimize';
import type { Preview } from './preview';
import type { ReviewEvent, StudyCard } from '../types';
import type { StudyContext } from '../studyContext';

export interface RunOptions {
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
	createWorker?: () => Worker;
	/** The weights the candidate is compared with; the defaults when omitted. */
	current?: readonly number[];
}

type Message =
	| { type: 'progress'; done: number; total: number }
	| { type: 'result'; result: OptimizeResult }
	| { type: 'error'; message: string };

function defaultWorker(): Worker {
	return new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
}

export function runOptimizer(data: Dataset, opts: RunOptions = {}): Promise<OptimizeResult> {
	return new Promise((resolve, reject) => {
		let worker: Worker;
		try {
			worker = (opts.createWorker ?? defaultWorker)();
		} catch {
			reject(new Error('The optimizer could not start in this browser.'));
			return;
		}
		const finish = (): void => {
			opts.signal?.removeEventListener('abort', onAbort);
			worker.terminate();
		};
		const onAbort = (): void => {
			finish();
			resolve({ ok: false, reason: 'stopped', labelled: data.labelled });
		};
		worker.onmessage = (event: MessageEvent<Message>) => {
			const m = event.data;
			if (m.type === 'progress') {
				opts.onProgress?.(m.total > 0 ? m.done / m.total : 0);
			} else if (m.type === 'result') {
				finish();
				resolve(m.result);
			} else {
				finish();
				reject(new Error(m.message));
			}
		};
		worker.onerror = () => {
			finish();
			reject(new Error('The optimizer stopped unexpectedly.'));
		};
		if (opts.signal?.aborted === true) {
			onAbort();
			return;
		}
		opts.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			worker.postMessage({ type: 'run', data, current: opts.current });
		} catch {
			finish();
			reject(new Error('The optimizer could not start in this browser.'));
		}
	});
}

export interface PreviewInput {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	from: readonly number[];
	to: readonly number[];
	now: Date;
	ctx: StudyContext;
}

/** runPreview computes previewChange in a worker so a long log never blocks the page. */
export function runPreview(
	input: PreviewInput,
	opts: { signal?: AbortSignal; createWorker?: () => Worker } = {}
): Promise<Preview> {
	return new Promise((resolve, reject) => {
		let worker: Worker;
		try {
			worker = (opts.createWorker ?? defaultWorker)();
		} catch {
			reject(new Error('The preview could not start in this browser.'));
			return;
		}
		const finish = (): void => {
			opts.signal?.removeEventListener('abort', onAbort);
			worker.terminate();
		};
		const onAbort = (): void => {
			finish();
			reject(new Error('The preview was cancelled.'));
		};
		worker.onmessage = (event: MessageEvent<{ type: string; preview?: Preview; message?: string }>) => {
			const m = event.data;
			if (m.type === 'preview' && m.preview !== undefined) {
				finish();
				resolve(m.preview);
			} else if (m.type === 'error') {
				finish();
				reject(new Error(m.message ?? 'The preview failed.'));
			}
		};
		worker.onerror = () => {
			finish();
			reject(new Error('The preview stopped unexpectedly.'));
		};
		if (opts.signal?.aborted === true) {
			onAbort();
			return;
		}
		opts.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			worker.postMessage({
				type: 'preview',
				cards: input.cards,
				reviews: input.reviews,
				from: input.from,
				to: input.to,
				now: input.now.getTime(),
				history: [...input.ctx.history],
				runs: [...input.ctx.clock.runs],
				vacationToday: input.ctx.vacationToday
			});
		} catch {
			finish();
			reject(new Error('The preview could not start in this browser.'));
		}
	});
}
