import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { StudyServer } from '../testing/studyServer';
import { PartialPushError } from './push';
import { decodeKeyedData, keyedData, keyedPath, keyedRowOf, pushKeyed } from './keyed';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function lastCall() {
	const calls = vi.mocked(fetch).mock.calls;
	const [url, init] = calls[calls.length - 1];
	return { url: String(url), init: (init ?? {}) as RequestInit };
}

/** A row of the list route or the pull, as the server sends it. */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		key: 'k',
		userId: 1,
		workspaceId: 3,
		data: { a: 1 },
		version: 2,
		updatedAt: '2026-01-01T00:00:00Z',
		deletedAt: null,
		...over
	};
}

describe('decodeKeyedData: one rule for every row', () => {
	it('decodes JSON text, keeps any other string and every non-string', () => {
		expect(decodeKeyedData('{"a":1}')).toEqual({ a: 1 });
		expect(decodeKeyedData('hello')).toBe('hello');
		expect(decodeKeyedData('{oops')).toBe('{oops');
		expect(decodeKeyedData({ a: 1 })).toEqual({ a: 1 });
		expect(decodeKeyedData(null)).toBeNull();
	});
});

describe('keyedRowOf: a row of the list route or of the pull', () => {
	it('decodes a row of the contract shape, data decoded', () => {
		expect(keyedRowOf(wire({ data: '{"a":1}' }))).toEqual({
			key: 'k',
			workspaceId: 3,
			data: { a: 1 },
			version: 2,
			updatedAt: '2026-01-01T00:00:00Z',
			deletedAt: null
		});
		expect(keyedRowOf(wire({ workspaceId: null, deletedAt: '2026-01-02T00:00:00Z' }))).toMatchObject({ workspaceId: null, deletedAt: '2026-01-02T00:00:00Z' });
	});

	it('refuses a row off the shape (record 0002: unreadable, skipped by the reader)', () => {
		const { version: _v, ...noVersion } = wire();
		void _v;
		for (const bad of [null, [], 'x', noVersion, wire({ key: 3 }), wire({ updatedAt: 'yesterday' }), wire({ extra: 1 })]) {
			expect(keyedRowOf(bad)).toBeNull();
		}
	});
});

describe('keyedPath', () => {
	it('escapes the key but keeps a colon readable, and scopes by workspace', () => {
		expect(keyedPath('entry:a b/c', 3)).toBe('/api/rows/entry:a%20b%2Fc?workspace=3');
		expect(keyedPath('layout', null)).toBe('/api/rows/layout');
	});

	it('refuses empty, dot and dot-dot keys', () => {
		for (const key of ['', '.', '..']) expect(() => keyedPath(key, null)).toThrow(/key/);
	});
});

describe('keyedData: the key routes of one scope', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('get: 404 is null, the data is decoded', async () => {
		const scope = keyedData(3);
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 404 }));
		expect(await scope.get('k')).toBeNull();
		vi.mocked(fetch).mockResolvedValue(json(wire({ data: '{"a":1}' })));
		expect(await scope.get('k')).toEqual({ a: 1 });
		expect(lastCall().url).toBe('/api/rows/k?workspace=3');
		vi.mocked(fetch).mockResolvedValue(json(wire({ data: 'hello' })));
		expect(await scope.get('k')).toBe('hello');
	});

	it('rejects bad keys before any request', async () => {
		const scope = keyedData(3);
		for (const key of ['', '.', '..']) {
			await expect(scope.get(key)).rejects.toThrow(/key/);
			await expect(scope.put(key, 1)).rejects.toThrow(/key/);
			await expect(scope.delete(key)).rejects.toThrow(/key/);
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('put sends the JSON body, passes keepalive and answers the stored row', async () => {
		vi.mocked(fetch).mockResolvedValue(json(wire({ data: { v: 1 } })));
		const row = await keyedData(null).put('k', { v: 1 }, { keepalive: true });
		expect(lastCall().url).toBe('/api/rows/k');
		expect(lastCall().init.method).toBe('PUT');
		expect(lastCall().init.keepalive).toBe(true);
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ v: 1 });
		expect(row).toMatchObject({ key: 'k', data: { v: 1 }, updatedAt: '2026-01-01T00:00:00Z' });
		vi.mocked(fetch).mockResolvedValue(json({}));
		expect(await keyedData(null).put('k', 1)).toBeNull();
	});

	it('list uses the prefix route and skips a row it cannot read', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.mocked(fetch).mockResolvedValue(json([wire({ key: 'entry:a' }), { key: 'entry:b', data: 1 }]));
		const rows = await keyedData(3).list('entry:');
		expect(lastCall().url).toBe('/api/rows?workspace=3&prefix=entry%3A');
		expect(rows.map((r) => r.key)).toEqual(['entry:a']);
	});

	it('find picks the exact key from the prefix route', async () => {
		vi.mocked(fetch).mockResolvedValue(json([wire({ key: 'ab', data: 2 }), wire({ key: 'a', data: 1 })]));
		expect(await keyedData(null).find('a')).toBe(1);
		vi.mocked(fetch).mockResolvedValue(json([]));
		expect(await keyedData(null).find('a')).toBeNull();
	});

	it('delete resolves when the row is missing, and rethrows every other failure', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ error: 'not_found', message: 'Plugin data not found.' }, 404));
		await expect(keyedData(3).delete('k')).resolves.toBeUndefined();
		vi.mocked(fetch).mockResolvedValue(json({ error: 'workspace_not_found', message: 'No such workspace.' }, 404));
		await expect(keyedData(3).delete('k')).rejects.toThrow();
		vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
		await expect(keyedData(3).delete('k')).rejects.toThrow();
		expect(lastCall().init.method).toBe('DELETE');
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(keyedData(3).delete('k')).rejects.toThrow();
	});
});

describe('pushKeyed: last-write-wins batch push of keyed rows', () => {
	let server: StudyServer;
	beforeEach(() => {
		server = new StudyServer({ now: () => Date.parse('2026-02-01T10:00:00Z') });
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn(server.fetch));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('stamps each row after the time the server holds and tells the stamps', async () => {
		server.putData({ key: 'b', workspaceId: 3, data: 1, updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });
		const sent = await pushKeyed(3, [
			{ key: 'a', data: { x: 1 } },
			{ key: 'b', data: {}, knownAt: '2026-03-01T00:00:00Z', deleted: true }
		], { now: () => Date.parse('2026-02-01T10:00:00Z') });
		expect(sent).toEqual(['2026-02-01T10:00:00.000Z', '2026-03-01T00:00:00.001Z']);
		const body = JSON.parse(String(lastCall().init.body)) as { rows: Record<string, unknown>[] };
		expect(body.rows).toEqual([
			{ key: 'a', workspaceId: 3, data: { x: 1 }, updatedAt: '2026-02-01T10:00:00.000Z' },
			{ key: 'b', workspaceId: 3, data: {}, updatedAt: '2026-03-01T00:00:00.001Z', deletedAt: '2026-03-01T00:00:00.001Z' }
		]);
	});

	it('sends chunks in order and reports a skipped row as a PartialPushError', async () => {
		server.putData({ key: 'b', workspaceId: 3, data: 1, updatedAt: '2026-05-01T00:00:00Z', deletedAt: null });
		const progress: number[] = [];
		const err = await pushKeyed(3, [{ key: 'a', data: 1 }, { key: 'b', data: 2 }, { key: 'c', data: 3 }], {
			chunk: 1,
			now: () => Date.parse('2026-02-01T10:00:00Z'),
			onProgress: (done) => progress.push(done)
		}).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PartialPushError);
		expect((err as PartialPushError).done).toBe(1);
		expect((err as PartialPushError).skipped).toBe(1);
		expect(progress).toEqual([1]);
		expect(server.counts.pushes).toBe(2);
	});
});
