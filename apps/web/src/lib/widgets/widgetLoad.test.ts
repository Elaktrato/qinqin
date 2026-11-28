import { beforeEach, describe, expect, it } from 'vitest';
import { newSession, testContext, type TestContext } from '$lib/testing/context';
import { WidgetLoad } from './widgetLoad.svelte';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const fail = (err: unknown): string => `failed: ${(err as Error).message}`;

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext();
});

describe('WidgetLoad (#290)', () => {
	it('a true first load shows loading, then the value', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		expect(w.loading).toBe(true);
		expect(w.value).toBeNull();
		await w.run(1, async () => 5, fail);
		expect(w.loading).toBe(false);
		expect(w.value).toBe(5);
	});

	it('a widget mounted again shows the last value of its workspace at once, never loading', async () => {
		await new WidgetLoad<number>(ctx.session, 'w', 1).run(1, async () => 5, fail);
		const again = new WidgetLoad<number>(ctx.session, 'w', 1);
		expect(again.value).toBe(5);
		expect(again.loading).toBe(false);
		const later = deferred<number>();
		const running = again.run(1, () => later.promise, fail);
		expect(again.loading).toBe(false);
		expect(again.value).toBe(5);
		later.resolve(6);
		await running;
		expect(again.value).toBe(6);
	});

	it("another workspace's value is never shown", async () => {
		await new WidgetLoad<number>(ctx.session, 'w', 1).run(1, async () => 5, fail);
		const w = new WidgetLoad<number>(ctx.session, 'w', 2);
		expect(w.value).toBeNull();
		expect(w.loading).toBe(true);
		const shown = new WidgetLoad<number>(ctx.session, 'w', 1);
		const later = deferred<number>();
		const running = shown.run(2, () => later.promise, fail);
		expect(shown.value).toBeNull();
		expect(shown.loading).toBe(true);
		later.resolve(7);
		await running;
		expect(shown.value).toBe(7);
	});

	it('a failed refresh keeps the value with a quiet notice; the next success clears it', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		await w.run(1, async () => 5, fail);
		await w.run(1, async () => {
			throw new Error('offline');
		}, fail);
		expect(w.value).toBe(5);
		expect(w.error).toBe('');
		expect(w.stale).toBe('failed: offline');
		await w.run(1, async () => 6, fail);
		expect(w.stale).toBe('');
	});

	it('a failed first load is an error', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		await w.run(1, async () => {
			throw new Error('offline');
		}, fail);
		expect(w.error).toBe('failed: offline');
		expect(w.loading).toBe(false);
	});

	it('an older load that answers last is dropped', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		const slow = deferred<number>();
		const first = w.run(1, () => slow.promise, fail);
		await w.run(1, async () => 2, fail);
		slow.resolve(1);
		await first;
		expect(w.value).toBe(2);
	});

	it('a new session holds nothing of the last one', async () => {
		await new WidgetLoad<number>(ctx.session, 'w', 1).run(1, async () => 5, fail);
		newSession(ctx);
		expect(new WidgetLoad<number>(ctx.session, 'w', 1).value).toBeNull();
	});

	it('clear drops the value and a load in flight', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		const later = deferred<number>();
		const running = w.run(1, () => later.promise, fail);
		w.clear();
		later.resolve(3);
		await running;
		expect(w.value).toBeNull();
		expect(w.loading).toBe(false);
	});

	it('a load can show a first value before it finishes (a two-step load)', async () => {
		const w = new WidgetLoad<number>(ctx.session, 'w', 1);
		const rest = deferred<number>();
		const running = w.run(1, async (show) => {
			show(1);
			return rest.promise;
		}, fail);
		await Promise.resolve();
		expect(w.value).toBe(1);
		expect(w.loading).toBe(false);
		rest.resolve(2);
		await running;
		expect(w.value).toBe(2);
	});
});
