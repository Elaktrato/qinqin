import { EntryBasesCache } from '$lib/context/caches';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { buildPatch, updateEntry } from './edit';

import type { Entry } from './types';

// A fresh EntryBasesCache per test (record 0009: the session owns one).
let cache = new EntryBasesCache();
beforeEach(() => {
	cache = new EntryBasesCache();
});

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function entry(overrides: Partial<Entry> = {}): Entry {
	return {
		id: 1,
		language: 'zh',
		kind: 'character',
		written: '发',
		readings: [
			{ type: 'pinyin', value: 'fā', plain: 'fa', ord: 0 },
			{ type: 'bopomofo', value: 'ㄈㄚ', plain: '', ord: 1 }
		],
		attrs: {},
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		...overrides
	};
}

function draft(original: Entry, overrides: Partial<{ written: string; readings: { type: string; value: string }[] }> = {}) {
	return {
		written: original.written,
		readings: [...original.readings]
			.sort((a, b) => a.ord - b.ord)
			.map(({ type, value }) => ({ type, value })),
		...overrides
	};
}

describe('buildPatch', () => {
	it('omits every field when the draft matches the entry', () => {
		const original = entry();

		expect(buildPatch(original, draft(original))).toEqual({});
	});

	it('sends written when it changed', () => {
		const original = entry();

		expect(buildPatch(original, draft(original, { written: '發' }))).toEqual({ written: '發' });
	});

	it('omits an empty written form', () => {
		const original = entry();

		expect(buildPatch(original, draft(original, { written: '' }))).toEqual({});
	});

	it('sends readings when a value changed', () => {
		const original = entry();
		const readings = [
			{ type: 'pinyin', value: 'fa4' },
			{ type: 'bopomofo', value: 'ㄈㄚ' }
		];

		expect(buildPatch(original, draft(original, { readings }))).toEqual({
			readings: [
				{ type: 'pinyin', value: 'fa4' },
				{ type: 'bopomofo', value: 'ㄈㄚ' }
			]
		});
	});

	it('treats a reordered reading as a change', () => {
		const original = entry();
		const readings = [
			{ type: 'bopomofo', value: 'ㄈㄚ' },
			{ type: 'pinyin', value: 'fā' }
		];

		expect(buildPatch(original, draft(original, { readings }))).toEqual({ readings });
	});

	it('compares readings in ord order, not storage order', () => {
		const original = entry({
			readings: [
				{ type: 'bopomofo', value: 'ㄈㄚ', plain: '', ord: 1 },
				{ type: 'pinyin', value: 'fā', plain: 'fa', ord: 0 }
			]
		});

		expect(buildPatch(original, draft(original))).toEqual({});
	});

	it('sends an added reading row', () => {
		const original = entry();
		const readings = [...draft(original).readings, { type: 'kana', value: 'はつ' }];

		expect(buildPatch(original, draft(original, { readings }))).toEqual({ readings });
	});

	it('sends an empty readings list when every row was removed', () => {
		const original = entry();

		expect(buildPatch(original, draft(original, { readings: [] }))).toEqual({ readings: [] });
	});

	it('sends both fields when both changed', () => {
		const original = entry();
		const readings = [{ type: 'pinyin', value: 'fa1' }];

		expect(buildPatch(original, draft(original, { written: '發', readings }))).toEqual({
			written: '發',
			readings
		});
	});
});

describe('updateEntry', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('PUTs the patch to the entry and returns the patched view', async () => {
		localStorage.setItem('qinqin.token', 'secret');
		const patched = entry({ written: '發' });
		vi.mocked(fetch).mockResolvedValue(jsonResponse(patched));

		const result = await updateEntry(cache, 1, { written: '發' });

		expect(result).toEqual(patched);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/entries/1');
		expect(init?.method).toBe('PUT');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
		expect(init?.body).toBe(JSON.stringify({ written: '發' }));
	});

	it('sends an empty readings list through as a clear', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(entry({ readings: [] })));

		await updateEntry(cache, 7, { readings: [] });

		const [, init] = vi.mocked(fetch).mock.calls[0];
		expect(init?.body).toBe(JSON.stringify({ readings: [] }));
	});
});
