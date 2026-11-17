import { describe, expect, it, vi } from 'vitest';
import { createLatestLoad } from './latestLoad';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createLatestLoad', () => {
	it('the latest load wins over a slower earlier one', async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const apply = vi.fn();
		const l = createLatestLoad(load, apply, () => {});
		const a = l.reload();
		const b = l.reload();
		second.resolve('new');
		await b;
		first.resolve('old');
		await a;
		expect(apply.mock.calls).toEqual([['new']]);
	});

	it('a failure of an outdated load is ignored, the latest one reported', async () => {
		const first = deferred<string>();
		const load = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('x'));
		const fail = vi.fn();
		const l = createLatestLoad(load, () => {}, fail);
		const a = l.reload();
		await l.reload();
		first.reject(new Error('old'));
		await a;
		expect(fail).toHaveBeenCalledTimes(1);
	});

	it('reloads asked for during a batch become one reload after it', async () => {
		const load = vi.fn(async () => 'v');
		const l = createLatestLoad(load, () => {}, () => {});
		await l.batch(async () => {
			void l.reload();
			void l.reload();
			void l.reload();
			expect(load).not.toHaveBeenCalled();
		});
		await Promise.resolve();
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('a batch without reloads loads nothing, and its result and errors pass through', async () => {
		const load = vi.fn(async () => 'v');
		const l = createLatestLoad(load, () => {}, () => {});
		expect(await l.batch(async () => 5)).toBe(5);
		await expect(l.batch(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		expect(load).not.toHaveBeenCalled();
	});

	it('after dispose nothing is applied', async () => {
		const d = deferred<string>();
		const apply = vi.fn();
		const l = createLatestLoad(() => d.promise, apply, () => {});
		const a = l.reload();
		l.dispose();
		d.resolve('late');
		await a;
		expect(apply).not.toHaveBeenCalled();
	});
});
