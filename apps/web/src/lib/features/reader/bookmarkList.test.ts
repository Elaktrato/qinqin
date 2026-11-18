import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import type { Bookmark } from './bookmarks';
import {
	BookmarkList,
	bookmarkKey,
	inWidget,
	isTextEntry,
	type BookmarkApi
} from './bookmarkList.svelte';

function mark(id: number, position: string, bookId = 1, label = `b${id}`): Bookmark {
	return { id, bookId, position, label, createdAt: '2026-11-13T10:00:00Z' };
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

function fakeApi(over: Partial<BookmarkApi> = {}): BookmarkApi {
	return {
		list: vi.fn(async () => []),
		add: vi.fn(async (bookId, position, label) => ({ ...mark(99, position, bookId), label })),
		rename: vi.fn(async (bookId, id, label) => ({ ...mark(id, '0:0', bookId), label: label.trim() })),
		remove: vi.fn(async () => {}),
		...over
	};
}

async function loaded(api: BookmarkApi, bookId = 1): Promise<BookmarkList> {
	const list = new BookmarkList(api);
	await list.load(bookId);
	return list;
}

describe('BookmarkList loading', () => {
	it('loads a book and drops a stale response of the previous book', async () => {
		const first = deferred<Bookmark[]>();
		const api = fakeApi({
			list: vi.fn((bookId: number) => (bookId === 1 ? first.promise : Promise.resolve([mark(5, '0:1', 2)])))
		});
		const list = new BookmarkList(api);
		const a = list.load(1);
		expect(list.loading).toBe(true);
		await list.load(2);
		first.resolve([mark(1, '0:0', 1)]);
		await a;
		expect(list.bookId).toBe(2);
		expect(list.items.map((b) => b.id)).toEqual([5]);
		expect(list.loading).toBe(false);
		expect(list.ready).toBe(true);
	});

	it('reports a load failure and is not ready', async () => {
		const list = await loaded(fakeApi({ list: vi.fn(async () => Promise.reject(new TypeError('x'))) }));
		expect(list.loadError).toBe('Could not load the bookmarks.');
		expect(list.ready).toBe(false);
	});

	it('a toggle after a failed load retries the load instead of doing nothing', async () => {
		let fail = true;
		const api = fakeApi({
			list: vi.fn(async () => (fail ? Promise.reject(new TypeError('x')) : [mark(4, '0:0')]))
		});
		const list = await loaded(api);
		fail = false;
		await list.toggle('0:0', 'x');
		expect(api.list).toHaveBeenCalledTimes(2);
		expect(list.loadError).toBe('');
		expect(list.items.map((b) => b.id)).toEqual([4]);
		// Only reloaded: the press did not also add or remove.
		expect(api.add).not.toHaveBeenCalled();
		expect(api.remove).not.toHaveBeenCalled();
	});

	it('announces an unlabelled bookmark by its place', async () => {
		const api = fakeApi({ add: vi.fn(async () => ({ ...mark(9, '2:3'), label: '' })) });
		const list = await loaded(api);
		await list.toggle('2:3', '');
		expect(list.announcement).toBe('Bookmark added: Untitled bookmark in chapter 3');
	});
});

describe('BookmarkList toggle', () => {
	it('adds optimistically, then keeps the server bookmark and announces it', async () => {
		const pending = deferred<Bookmark>();
		const api = fakeApi({ add: vi.fn(() => pending.promise) });
		const list = await loaded(api);
		const done = list.toggle('2:3', 'snippet');
		expect(list.saving).toBe(true);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].id).toBeLessThan(0);
		expect(list.at('2:3')?.label).toBe('snippet');
		pending.resolve(mark(7, '2:3', 1, 'snippet'));
		await done;
		expect(api.add).toHaveBeenCalledWith(1, '2:3', 'snippet');
		expect(list.items.map((b) => b.id)).toEqual([7]);
		expect(list.saving).toBe(false);
		expect(list.announcement).toBe('Bookmark added: snippet');
	});

	it('dedupes when the server returns an existing bookmark (200)', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [mark(3, '0:0')]),
			add: vi.fn(async () => mark(3, '0:0'))
		});
		const list = await loaded(api);
		// The local list did not know about it: still one row afterwards.
		list.items = [];
		await list.toggle('0:0', 'x');
		expect(list.items.map((b) => b.id)).toEqual([3]);
	});

	it('rolls an add back on failure with a friendly error', async () => {
		const api = fakeApi({ add: vi.fn(async () => Promise.reject(new ApiError(409, 'too many'))) });
		const list = await loaded(api);
		await list.toggle('0:0', 'x');
		expect(list.items).toEqual([]);
		expect(list.error).toMatch(/most bookmarks allowed \(200\)/);
		expect(list.saving).toBe(false);
	});

	it('removes the bookmark at the position, and restores it on failure', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [mark(4, '1:1')]),
			remove: vi.fn(async () => Promise.reject(new TypeError('offline')))
		});
		const list = await loaded(api);
		const done = list.toggle('1:1', 'ignored');
		expect(list.items).toEqual([]);
		await done;
		expect(api.add).not.toHaveBeenCalled();
		expect(api.remove).toHaveBeenCalledWith(1, 4);
		expect(list.items.map((b) => b.id)).toEqual([4]);
		expect(list.error).toBe('Could not save the bookmark.');
	});

	it('treats a 404 on delete as already gone', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [mark(4, '1:1')]),
			remove: vi.fn(async () => Promise.reject(new ApiError(404, 'not found')))
		});
		const list = await loaded(api);
		await list.toggle('1:1', '');
		expect(list.items).toEqual([]);
		expect(list.error).toBe('');
		expect(list.announcement).toBe('Bookmark removed: b4');
	});

	it('ignores a toggle while one is saving or before the list is loaded', async () => {
		const pending = deferred<Bookmark>();
		const api = fakeApi({ add: vi.fn(() => pending.promise) });
		const list = new BookmarkList(api);
		await list.toggle('0:0', 'x');
		expect(api.add).not.toHaveBeenCalled();
		await list.load(1);
		const first = list.toggle('0:0', 'x');
		await list.toggle('0:0', 'x');
		expect(api.add).toHaveBeenCalledTimes(1);
		pending.resolve(mark(1, '0:0'));
		await first;
	});

	it('drops a mutation result that arrives after switching books', async () => {
		const pending = deferred<Bookmark>();
		const api = fakeApi({
			add: vi.fn(() => pending.promise),
			list: vi.fn(async (bookId: number) => (bookId === 2 ? [mark(8, '0:0', 2)] : []))
		});
		const list = await loaded(api);
		const done = list.toggle('0:0', 'x');
		await list.load(2);
		pending.reject(new TypeError('late'));
		await done;
		expect(list.items.map((b) => b.id)).toEqual([8]);
		expect(list.error).toBe('');
		expect(list.saving).toBe(false);
	});
});

describe('BookmarkList rename and delete', () => {
	it('renames optimistically and keeps the cleaned server label', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [mark(4, '1:1')]),
			rename: vi.fn(async () => ({ ...mark(4, '1:1'), label: 'clean' }))
		});
		const list = await loaded(api);
		const done = list.rename(4, '  clean  ');
		expect(list.items[0].label).toBe('clean');
		expect(list.busy(4)).toBe(true);
		await done;
		expect(api.rename).toHaveBeenCalledWith(1, 4, 'clean');
		expect(list.items[0].label).toBe('clean');
		expect(list.busy(4)).toBe(false);
	});

	it('rolls a failed rename back', async () => {
		const api = fakeApi({
			list: vi.fn(async () => [mark(4, '1:1', 1, 'old')]),
			rename: vi.fn(async () => Promise.reject(new ApiError(422, 'label too long')))
		});
		const list = await loaded(api);
		await list.rename(4, 'new');
		expect(list.items[0].label).toBe('old');
		expect(list.error).toBe('label too long');
	});

	it('skips a rename that changes nothing', async () => {
		const api = fakeApi({ list: vi.fn(async () => [mark(4, '1:1', 1, 'same')]) });
		const list = await loaded(api);
		await list.rename(4, ' same ');
		expect(api.rename).not.toHaveBeenCalled();
	});

	it('deletes by id and announces it', async () => {
		const api = fakeApi({ list: vi.fn(async () => [mark(4, '1:1'), mark(5, '2:2')]) });
		const list = await loaded(api);
		await list.remove(5);
		expect(list.items.map((b) => b.id)).toEqual([4]);
		expect(list.announcement).toBe('Bookmark removed: b5');
	});
});

describe('bookmarkKey', () => {
	const key = (over: Partial<KeyboardEvent> = {}) => ({
		key: 'b',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		isComposing: false,
		defaultPrevented: false,
		...over
	});
	const calm = { typing: false, popupOpen: false };

	it('accepts a plain b', () => {
		expect(bookmarkKey(key(), calm)).toBe(true);
		// Caps Lock: B without Shift.
		expect(bookmarkKey(key({ key: 'B' }), calm)).toBe(true);
	});

	it.each([
		['another key', { key: 'n' }],
		['shift (B)', { key: 'B', shiftKey: true }],
		['ctrl', { ctrlKey: true }],
		['meta', { metaKey: true }],
		['alt', { altKey: true }],
		['a held key', { repeat: true }],
		['IME composition', { isComposing: true }],
		['an already handled key', { defaultPrevented: true }]
	])('rejects %s', (_name, over) => {
		expect(bookmarkKey(key(over as Partial<KeyboardEvent>), calm)).toBe(false);
	});

	it('treats only text-entry controls as typing', () => {
		const el = (tagName: string, type?: string, isContentEditable = false) => ({ tagName, type, isContentEditable });
		for (const type of ['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', undefined, '']) {
			expect(isTextEntry(el('INPUT', type)), `input ${type}`).toBe(true);
		}
		expect(isTextEntry(el('TEXTAREA'))).toBe(true);
		expect(isTextEntry(el('DIV', undefined, true))).toBe(true);
		for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']) {
			expect(isTextEntry(el('INPUT', type)), `input ${type}`).toBe(false);
		}
		expect(isTextEntry(el('SELECT'))).toBe(false);
		expect(isTextEntry(el('BUTTON'))).toBe(false);
		expect(isTextEntry(el('P'))).toBe(false);
		expect(isTextEntry(null)).toBe(false);
	});

	it('rejects inside a listbox, menu or dialog, or on the trigger of an open one', () => {
		// A fake element whose closest() matches only the given selector parts.
		const inside = (part: string) => ({
			closest: (sel: string) => (sel.split(',').some((s) => s.trim() === part) ? {} : null)
		});
		const noDoc = { querySelector: () => null };
		for (const part of [
			'[role="listbox"]',
			'[role="menu"]',
			'[role="dialog"]',
			// The shared Sheet/Dialog are native <dialog>s (implicit role).
			'dialog',
			'[aria-haspopup][aria-expanded="true"]'
		]) {
			expect(inWidget(inside(part), noDoc), part).toBe(true);
		}
		// A plain disclosure (the bookmarks panel toggle) is not a widget.
		expect(inWidget(inside('[aria-expanded="true"]'), noDoc)).toBe(false);
		expect(inWidget(inside('main'), noDoc)).toBe(false);
		expect(inWidget(null, noDoc)).toBe(false);
	});

	it('rejects while a listbox or menu is open anywhere, wherever focus is', () => {
		const outside = { closest: () => null };
		const openMenu = {
			querySelector: (sel: string) =>
				sel.split(',').some((s) => s.trim() === '[role="menu"]') ? {} : null
		};
		const openListbox = {
			querySelector: (sel: string) =>
				sel.split(',').some((s) => s.trim() === '[role="listbox"]') ? {} : null
		};
		const openDialog = {
			querySelector: (sel: string) =>
				sel.split(',').some((s) => s.trim() === 'dialog[open]') ? {} : null
		};
		expect(inWidget(outside, openMenu)).toBe(true);
		expect(inWidget(null, openListbox)).toBe(true);
		// A modal sheet owns the keys with focus anywhere.
		expect(inWidget(outside, openDialog)).toBe(true);
		expect(inWidget(outside, { querySelector: () => null })).toBe(false);
		expect(inWidget(outside, null)).toBe(false);
	});

	it('rejects while typing or with a popup open', () => {
		expect(bookmarkKey(key(), { typing: true, popupOpen: false })).toBe(false);
		expect(bookmarkKey(key(), { typing: false, popupOpen: true })).toBe(false);
	});
});
