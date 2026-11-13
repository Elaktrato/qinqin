import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import { HighlightOverlapError } from '$lib/api/library';
import type { Highlight, HighlightColor } from './highlights';
import { HighlightList, type HighlightApi, type NewHighlight } from './highlightList.svelte';

function hl(id: number, over: Partial<Highlight> = {}): Highlight {
	return {
		id,
		bookId: 1,
		chapter: 0,
		paragraph: 0,
		start: 0,
		end: 2,
		text: '猫が',
		color: 'yellow',
		note: '',
		createdAt: '2026-11-13T10:00:00Z',
		updatedAt: '2026-11-13T10:00:00Z',
		...over
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const body: NewHighlight = { chapter: 1, paragraph: 2, start: 3, end: 5, text: '漢字', color: 'green', note: '' };

function fakeApi(over: Partial<HighlightApi> = {}): HighlightApi {
	return {
		list: vi.fn(async () => []),
		add: vi.fn(async (bookId: number, b: NewHighlight) => hl(99, { ...b, bookId })),
		update: vi.fn(async (bookId: number, id: number, patch: { color?: HighlightColor; note?: string }) =>
			hl(id, { bookId, ...patch })
		),
		remove: vi.fn(async () => {}),
		...over
	};
}

async function loaded(api: HighlightApi, bookId = 1): Promise<HighlightList> {
	const list = new HighlightList(api);
	await list.load(bookId);
	return list;
}

describe('HighlightList loading', () => {
	it('loads a book and drops a stale response of the previous book', async () => {
		const first = deferred<Highlight[]>();
		const api = fakeApi({
			list: vi.fn((bookId: number) => (bookId === 1 ? first.promise : Promise.resolve([hl(5, { bookId: 2 })])))
		});
		const list = new HighlightList(api);
		const a = list.load(1);
		expect(list.loading).toBe(true);
		expect(list.ready).toBe(false);
		await list.load(2);
		first.resolve([hl(1)]);
		await a;
		expect(list.bookId).toBe(2);
		expect(list.items.map((h) => h.id)).toEqual([5]);
		expect(list.loading).toBe(false);
		expect(list.ready).toBe(true);
	});

	it('reports a load failure and is not ready', async () => {
		const list = await loaded(fakeApi({ list: vi.fn(async () => Promise.reject(new TypeError('x'))) }));
		expect(list.loadError).toBe('Could not load the highlights.');
		expect(list.ready).toBe(false);
	});

	it('get finds a highlight by id', async () => {
		const list = await loaded(fakeApi({ list: vi.fn(async () => [hl(3), hl(4)]) }));
		expect(list.get(4)?.id).toBe(4);
		expect(list.get(9)).toBeNull();
	});
});

describe('HighlightList add', () => {
	it('adds optimistically, then keeps the server highlight and announces it', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({ add: vi.fn(() => pending.promise) });
		const list = await loaded(api);
		const done = list.add(body);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].id).toBeLessThan(0);
		expect(list.busy(list.items[0].id)).toBe(true);
		expect(list.items[0]).toMatchObject({ ...body, bookId: 1 });
		pending.resolve(hl(7, { ...body }));
		const result = await done;
		expect(api.add).toHaveBeenCalledWith(1, body);
		expect(result).toEqual({ ok: true, highlight: expect.objectContaining({ id: 7 }) });
		expect(list.items.map((h) => h.id)).toEqual([7]);
		expect(list.announcement).toBe('Highlight added: 漢字');
	});

	it('rolls an add back on failure with a friendly error', async () => {
		const api = fakeApi({ add: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
		const list = await loaded(api);
		const result = await list.add(body);
		expect(result).toEqual({ ok: false });
		expect(list.items).toEqual([]);
		expect(list.error).toBe('Could not save the highlight.');
	});

	it('rolls back an overlap and reports the existing highlight without an error', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(4)]),
			add: vi.fn(async () => Promise.reject(new HighlightOverlapError('overlaps highlight 4', 4)))
		});
		const list = await loaded(api);
		const result = await list.add(body);
		expect(result).toEqual({ ok: false, existingId: 4, available: true });
		expect(list.items.map((h) => h.id)).toEqual([4]);
		expect(list.error).toBe('');
		// Known locally: no reload.
		expect(api.list).toHaveBeenCalledTimes(1);
	});

	it('reloads once when the overlapped highlight is not known locally (another tab)', async () => {
		let lists = 0;
		const api = fakeApi({
			list: vi.fn(async () => (++lists === 1 ? [hl(4)] : [hl(4), hl(12, { chapter: 1, paragraph: 2, start: 2, end: 4 })])),
			add: vi.fn(async () => Promise.reject(new HighlightOverlapError('already highlighted', 12)))
		});
		const list = await loaded(api);
		expect(await list.add(body)).toEqual({ ok: false, existingId: 12, available: true });
		expect(api.list).toHaveBeenCalledTimes(2);
		expect(list.get(12)?.id).toBe(12);
		expect(list.items.map((h) => h.id)).toEqual([4, 12]);
		expect(list.error).toBe('');
	});

	it('says so when the overlapped highlight is still unknown after the reload', async () => {
		const api = fakeApi({
			add: vi.fn(async () => Promise.reject(new HighlightOverlapError('already highlighted', 12)))
		});
		const list = await loaded(api);
		expect(await list.add(body)).toEqual({ ok: false, existingId: 12, available: false });
		expect(api.list).toHaveBeenCalledTimes(2);
		// A failed reload is not a load error: the list stays usable.
		let loadedOnce = false;
		const failing = await loaded(
			fakeApi({
				list: vi.fn(async () => (loadedOnce ? Promise.reject(new TypeError('x')) : [])),
				add: vi.fn(async () => Promise.reject(new HighlightOverlapError('already highlighted', 12)))
			})
		);
		loadedOnce = true;
		expect(await failing.add(body)).toEqual({ ok: false, existingId: 12, available: false });
		expect(failing.ready).toBe(true);
		expect(failing.loadError).toBe('');
	});

	it('the reload keeps unsaved local edits', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({
			list: vi.fn(async () => [hl(4)]),
			update: vi.fn(() => pending.promise),
			add: vi.fn(async () => Promise.reject(new HighlightOverlapError('already highlighted', 12)))
		});
		const list = await loaded(api);
		const editing = list.update(4, { note: 'mine' });
		await list.add(body);
		expect(list.get(4)?.note).toBe('mine');
		pending.resolve(hl(4, { note: 'mine' }));
		expect(await editing).toBe(true);
	});

	it('refuses locally when the selection overlaps a known highlight', async () => {
		const api = fakeApi({ list: vi.fn(async () => [hl(4, { chapter: 1, paragraph: 2, start: 4, end: 8 })]) });
		const list = await loaded(api);
		expect(await list.add(body)).toEqual({ ok: false, existingId: 4, available: true });
		expect(api.add).not.toHaveBeenCalled();
		// The same range in another chapter is not an overlap.
		const other = await loaded(fakeApi({ list: vi.fn(async () => [hl(4, { chapter: 0, paragraph: 2, start: 3, end: 5 })]) }));
		expect((await other.add(body)).ok).toBe(true);
	});

	it('explains the cap (409 without an existing id)', async () => {
		const api = fakeApi({ add: vi.fn(async () => Promise.reject(new ApiError(409, 'too many highlights'))) });
		const list = await loaded(api);
		await list.add(body);
		expect(list.items).toEqual([]);
		expect(list.error).toBe(
			'This book already has the most highlights allowed (2000). Delete one to add another.'
		);
	});

	it('does nothing before the list is loaded', async () => {
		const api = fakeApi();
		const list = new HighlightList(api);
		expect(await list.add(body)).toEqual({ ok: false });
		expect(api.add).not.toHaveBeenCalled();
	});

	it('drops an add result that arrives after switching books', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({
			add: vi.fn(() => pending.promise),
			list: vi.fn(async (bookId: number) => (bookId === 2 ? [hl(8, { bookId: 2 })] : []))
		});
		const list = await loaded(api);
		const done = list.add(body);
		await list.load(2);
		pending.resolve(hl(7));
		expect(await done).toEqual({ ok: false });
		expect(list.items.map((h) => h.id)).toEqual([8]);
		expect(list.error).toBe('');
		expect(list.announcement).toBe('');
	});

	it('drops a failed add that arrives after switching books', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({
			add: vi.fn(() => pending.promise),
			list: vi.fn(async () => [hl(8, { bookId: 2 })])
		});
		const list = await loaded(api);
		const done = list.add(body);
		await list.load(2);
		pending.reject(new TypeError('late'));
		await done;
		expect(list.items.map((h) => h.id)).toEqual([8]);
		expect(list.error).toBe('');
	});
});

describe('HighlightList update and remove', () => {
	it('updates colour and note optimistically and keeps the server version', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: vi.fn(() => pending.promise) });
		const list = await loaded(api);
		const done = list.update(4, { color: 'pink', note: 'note' });
		expect(list.items[0]).toMatchObject({ color: 'pink', note: 'note' });
		expect(list.busy(4)).toBe(true);
		pending.resolve(hl(4, { color: 'pink', note: 'note (clean)', updatedAt: '2026-11-13T11:00:00Z' }));
		expect(await done).toBe(true);
		expect(api.update).toHaveBeenCalledWith(1, 4, { color: 'pink', note: 'note' });
		expect(list.items[0]).toMatchObject({ note: 'note (clean)', updatedAt: '2026-11-13T11:00:00Z' });
		expect(list.busy(4)).toBe(false);
		expect(list.announcement).toBe('Highlight updated');
	});

	it('sends only what changed and skips a no-op', async () => {
		const api = fakeApi({ list: vi.fn(async () => [hl(4, { color: 'blue', note: 'n' })]) });
		const list = await loaded(api);
		expect(await list.update(4, { color: 'blue', note: 'n' })).toBe(true);
		expect(api.update).not.toHaveBeenCalled();
		await list.update(4, { color: 'blue', note: 'm' });
		expect(api.update).toHaveBeenCalledWith(1, 4, { note: 'm' });
	});

	it('rolls a failed update back', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(4, { note: 'old' })]),
			update: vi.fn(async () => Promise.reject(new ApiError(422, 'note too long')))
		});
		const list = await loaded(api);
		expect(await list.update(4, { note: 'new' })).toBe(false);
		expect(list.items[0].note).toBe('old');
		expect(list.error).toBe('note too long');
	});

	it('drops a highlight that is gone on the server when updating it', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(4)]),
			update: vi.fn(async () => Promise.reject(new ApiError(404, 'not found')))
		});
		const list = await loaded(api);
		await list.update(4, { color: 'green' });
		expect(list.items).toEqual([]);
		expect(list.error).toBe('This highlight no longer exists.');
	});


	it('drops an update result that arrives after switching books', async () => {
		const pending = deferred<Highlight>();
		const api = fakeApi({
			list: vi.fn(async (bookId: number) => (bookId === 1 ? [hl(4)] : [hl(9, { bookId: 2 })])),
			update: vi.fn(() => pending.promise)
		});
		const list = await loaded(api);
		const done = list.update(4, { note: 'x' });
		await list.load(2);
		pending.reject(new TypeError('late'));
		expect(await done).toBe(false);
		expect(list.items.map((h) => h.id)).toEqual([9]);
		expect(list.error).toBe('');
	});

	it('removes optimistically and restores on failure', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(4), hl(5, { start: 3, end: 4, text: '好' })]),
			remove: vi.fn(async () => Promise.reject(new TypeError('offline')))
		});
		const list = await loaded(api);
		const done = list.remove(4);
		expect(list.items.map((h) => h.id)).toEqual([5]);
		await done;
		expect(api.remove).toHaveBeenCalledWith(1, 4);
		expect(list.items.map((h) => h.id).sort()).toEqual([4, 5]);
		expect(list.error).toBe('Could not save the highlight.');
	});

	it('treats a 404 on delete as already gone and announces the removal', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(4)]),
			remove: vi.fn(async () => Promise.reject(new ApiError(404, 'not found')))
		});
		const list = await loaded(api);
		await list.remove(4);
		expect(list.items).toEqual([]);
		expect(list.error).toBe('');
		expect(list.announcement).toBe('Highlight removed: 猫が');
	});

	it('keeps the list ordered by chapter, paragraph and start', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [hl(1, { chapter: 2 }), hl(2, { chapter: 0, paragraph: 5 })]),
			add: vi.fn(async (_b: number, b: NewHighlight) => hl(3, { ...b }))
		});
		const list = await loaded(api);
		await list.add(body);
		expect(list.items.map((h) => h.id)).toEqual([2, 3, 1]);
	});
});

// A queue of controllable server answers for one API method.
function answers<T>() {
	const queue: ReturnType<typeof deferred<T>>[] = [];
	const fn = vi.fn(() => {
		const d = deferred<T>();
		queue.push(d);
		return d.promise;
	});
	return { fn, queue };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('HighlightList edits are never lost', () => {
	it('colour, then note before the first returns: the note is sent right after', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: up.fn });
		const list = await loaded(api);
		const colour = list.update(4, { color: 'pink' });
		const note = list.update(4, { note: 'long note' });
		// Both show at once; only one request is in flight.
		expect(list.get(4)).toMatchObject({ color: 'pink', note: 'long note' });
		expect(api.update).toHaveBeenCalledTimes(1);
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { color: 'pink' });
		up.queue[0].resolve(hl(4, { color: 'pink' }));
		await flush();
		// The server's answer to the first did not wipe the pending note.
		expect(list.get(4)).toMatchObject({ color: 'pink', note: 'long note' });
		expect(api.update).toHaveBeenCalledTimes(2);
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { note: 'long note' });
		up.queue[1].resolve(hl(4, { color: 'pink', note: 'long note' }));
		expect(await colour).toBe(true);
		expect(await note).toBe(true);
		expect(list.busy(4)).toBe(false);
		expect(list.error).toBe('');
	});

	it('merges queued edits, the latest value per field winning', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: up.fn });
		const list = await loaded(api);
		const all = [
			list.update(4, { color: 'pink' }),
			list.update(4, { note: 'a' }),
			list.update(4, { color: 'blue', note: 'b' }),
			list.update(4, { note: 'c' })
		];
		up.queue[0].resolve(hl(4, { color: 'pink' }));
		await flush();
		expect(api.update).toHaveBeenCalledTimes(2);
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { color: 'blue', note: 'c' });
		up.queue[1].resolve(hl(4, { color: 'blue', note: 'c' }));
		expect(await Promise.all(all)).toEqual([true, true, true, true]);
		expect(list.get(4)).toMatchObject({ color: 'blue', note: 'c' });
	});

	it("'Note' right after add: the edit waits for the add, then is sent to the real id", async () => {
		const add = answers<Highlight>();
		const api = fakeApi({ add: add.fn });
		const list = await loaded(api);
		const adding = list.add(body);
		const tempId = list.items[0].id;
		expect(tempId).toBeLessThan(0);
		const note = list.update(tempId, { note: 'my note' });
		expect(list.get(tempId)?.note).toBe('my note');
		expect(api.update).not.toHaveBeenCalled();
		add.queue[0].resolve(hl(7, { ...body }));
		const result = await adding;
		expect(result.ok && result.highlight.id).toBe(7);
		expect(await note).toBe(true);
		expect(api.update).toHaveBeenCalledWith(1, 7, { note: 'my note' });
		expect(list.items.map((h) => h.id)).toEqual([7]);
		expect(list.get(7)?.note).toBe('my note');
		// The temporary id still finds the saved highlight.
		expect(list.get(tempId)?.id).toBe(7);
	});

	it('edits queued on an add that fails are dropped with it', async () => {
		const api = fakeApi({ add: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
		const list = await loaded(api);
		const adding = list.add(body);
		const note = list.update(list.items[0].id, { note: 'n' });
		await adding;
		expect(await note).toBe(false);
		expect(api.update).not.toHaveBeenCalled();
		expect(list.items).toEqual([]);
		expect(list.error).toBe('Could not save the highlight.');
	});

	it('a failed first edit reverts only its fields; the queued second is still sent', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4, { color: 'yellow', note: 'old' })]), update: up.fn });
		const list = await loaded(api);
		const colour = list.update(4, { color: 'pink' });
		const note = list.update(4, { note: 'new' });
		up.queue[0].reject(new ApiError(422, 'bad colour'));
		await flush();
		// The colour is back to the server's; the note still shows and is sent.
		expect(list.get(4)).toMatchObject({ color: 'yellow', note: 'new' });
		expect(list.error).toBe('bad colour');
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { note: 'new' });
		up.queue[1].resolve(hl(4, { color: 'yellow', note: 'new' }));
		expect(await colour).toBe(false);
		expect(await note).toBe(true);
		expect(list.get(4)).toMatchObject({ color: 'yellow', note: 'new' });
	});

	it('a failed first edit does not revert a field a queued edit changes again', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: up.fn });
		const list = await loaded(api);
		void list.update(4, { color: 'pink' });
		const second = list.update(4, { color: 'blue' });
		up.queue[0].reject(new TypeError('offline'));
		await flush();
		expect(list.get(4)?.color).toBe('blue');
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { color: 'blue' });
		up.queue[1].reject(new TypeError('offline'));
		expect(await second).toBe(false);
		// Both failed: back to the last confirmed colour.
		expect(list.get(4)?.color).toBe('yellow');
		expect(list.error).toBe('Could not save the highlight.');
	});

	it('an edit back to the confirmed value while one is in flight is still sent', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: up.fn });
		const list = await loaded(api);
		void list.update(4, { color: 'pink' });
		const back = list.update(4, { color: 'yellow' });
		up.queue[0].resolve(hl(4, { color: 'pink' }));
		await flush();
		expect(api.update).toHaveBeenLastCalledWith(1, 4, { color: 'yellow' });
		up.queue[1].resolve(hl(4, { color: 'yellow' }));
		expect(await back).toBe(true);
		expect(list.get(4)?.color).toBe('yellow');
	});

	it('remove while editing: gone at once, deleted after the edit settles, never re-added', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({ list: vi.fn(async () => [hl(4)]), update: up.fn });
		const list = await loaded(api);
		const editing = list.update(4, { note: 'x' });
		const queuedNote = list.update(4, { note: 'y' });
		const removing = list.remove(4);
		expect(list.items).toEqual([]);
		expect(api.remove).not.toHaveBeenCalled();
		up.queue[0].resolve(hl(4, { note: 'x' }));
		await removing;
		expect(api.remove).toHaveBeenCalledWith(1, 4);
		// The queued note was not sent: the highlight is being deleted.
		expect(api.update).toHaveBeenCalledTimes(1);
		expect(await editing).toBe(true);
		expect(await queuedNote).toBe(false);
		expect(list.items).toEqual([]);
		expect(list.announcement).toBe('Highlight removed: 猫が');
	});

	it('remove while editing restores the last confirmed highlight when the delete fails', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({
			list: vi.fn(async () => [hl(4)]),
			update: up.fn,
			remove: vi.fn(async () => Promise.reject(new TypeError('offline')))
		});
		const list = await loaded(api);
		void list.update(4, { color: 'green' });
		const removing = list.remove(4);
		up.queue[0].resolve(hl(4, { color: 'green' }));
		await removing;
		expect(list.items.map((h) => [h.id, h.color])).toEqual([[4, 'green']]);
		expect(list.error).toBe('Could not save the highlight.');
	});

	it('remove right after add deletes the saved highlight once the add resolves', async () => {
		const add = answers<Highlight>();
		const api = fakeApi({ add: add.fn });
		const list = await loaded(api);
		const adding = list.add(body);
		const removing = list.remove(list.items[0].id);
		expect(list.items).toEqual([]);
		add.queue[0].resolve(hl(7, { ...body }));
		await adding;
		await removing;
		expect(api.remove).toHaveBeenCalledWith(1, 7);
		expect(list.items).toEqual([]);
	});

	it('drops queued edits on a book switch: nothing is sent for the old book afterwards', async () => {
		const up = answers<Highlight>();
		const api = fakeApi({
			list: vi.fn(async (bookId: number) => (bookId === 1 ? [hl(4)] : [hl(9, { bookId: 2 })])),
			update: up.fn
		});
		const list = await loaded(api);
		const first = list.update(4, { color: 'pink' });
		const second = list.update(4, { note: 'n' });
		await list.load(2);
		up.queue[0].resolve(hl(4, { color: 'pink' }));
		expect(await first).toBe(false);
		expect(await second).toBe(false);
		expect(api.update).toHaveBeenCalledTimes(1);
		expect(list.items.map((h) => h.id)).toEqual([9]);
		expect(list.busy(9)).toBe(false);
	});
});
