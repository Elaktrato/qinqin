// Runs the optimizer and the due-date preview off the main thread.
// Protocol in: {type:'run', data, current?} or {type:'preview', cards,
// reviews, from, to, now}; out: progress, result, preview or error.

import type { ReviewEvent, StudyCard } from '../types';
import type { Dataset } from './dataset';
import { optimize } from './optimize';
import { previewChange } from './preview';

type In =
	| { type: 'run'; data: Dataset; current?: number[] }
	| {
			type: 'preview';
			cards: StudyCard[];
			reviews: ReviewEvent[];
			from: number[];
			to: number[];
			now: number;
	  };

self.onmessage = (event: MessageEvent<In>) => {
	const m = event.data;
	try {
		if (m.type === 'run') {
			const result = optimize(m.data, {
				current: m.current,
				onProgress: (done, total) => self.postMessage({ type: 'progress', done, total })
			});
			self.postMessage({ type: 'result', result });
		} else if (m.type === 'preview') {
			const preview = previewChange({
				cards: m.cards,
				reviews: m.reviews,
				from: m.from,
				to: m.to,
				now: new Date(m.now)
			});
			self.postMessage({ type: 'preview', preview });
		}
	} catch (e) {
		self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
	}
};
