// A reload that only ever applies its newest answer (#68 review): the
// reader's known index is reloaded after every study write, and a slow
// earlier load must never overwrite a newer one. Writes made inside
// `batch` (a bulk add or mark pushes several chunks, each notifying) ask
// for one reload when the batch ends instead of one per chunk.

export interface LatestLoad {
	reload(): Promise<void>;
	batch<R>(run: () => Promise<R>): Promise<R>;
	dispose(): void;
}

export function createLatestLoad<T>(
	load: () => Promise<T>,
	apply: (value: T) => void,
	fail: (err: unknown) => void
): LatestLoad {
	let seq = 0;
	let held = 0;
	let pending = false;
	let alive = true;

	async function reload(): Promise<void> {
		if (!alive) return;
		if (held > 0) {
			pending = true;
			return;
		}
		const mine = ++seq;
		try {
			const value = await load();
			if (alive && mine === seq) apply(value);
		} catch (err) {
			if (alive && mine === seq) fail(err);
		}
	}

	async function batch<R>(run: () => Promise<R>): Promise<R> {
		held++;
		try {
			return await run();
		} finally {
			held--;
			if (held === 0 && pending) {
				pending = false;
				void reload();
			}
		}
	}

	return {
		reload,
		batch,
		dispose: () => {
			alive = false;
			seq++;
		}
	};
}
