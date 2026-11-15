// Runs the optimizer off the main thread. Protocol: {type:'run', data}
// in; progress, result or error messages out.

import type { Dataset } from './dataset';
import { optimize } from './optimize';

self.onmessage = (event: MessageEvent<{ type: 'run'; data: Dataset }>) => {
	if (event.data.type !== 'run') return;
	try {
		const result = optimize(event.data.data, {
			onProgress: (done, total) => self.postMessage({ type: 'progress', done, total })
		});
		self.postMessage({ type: 'result', result });
	} catch (e) {
		self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
	}
};
