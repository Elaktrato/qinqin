import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { fixtureManifest } from './fixtures';
import { PermissionError, createPluginSdk } from './sdk';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function lastCall() {
	const calls = vi.mocked(fetch).mock.calls;
	const [url, init] = calls[calls.length - 1];
	return { url: String(url), init: (init ?? {}) as RequestInit };
}

const full = fixtureManifest({
	id: 'qinqin-test',
	name: 'Test',
	surfaces: ['hook'],
	hooks: ['study-event'],
	permissions: ['owns-data', 'read:study-events', 'write:study-events'],
	events: [{ type: 'journal' }]
});
const bare = fixtureManifest({ id: 'qinqin-bare', name: 'Bare' });

describe('plugin sdk permissions', () => {
	it('data needs owns-data', () => {
		expect(() => createPluginSdk(bare).data.user()).toThrow(PermissionError);
		expect(() => createPluginSdk(bare).data.workspace(1)).toThrow(/qinqin-bare.*owns-data/);
	});

	it('events.list needs read:study-events', () => {
		expect(() => createPluginSdk(bare).events.list({})).toThrow(/qinqin-bare.*read:study-events/);
	});

	it('events.record needs write:study-events', () => {
		expect(() => createPluginSdk(bare).events.record('journal', 1)).toThrow(
			/qinqin-bare.*write:study-events/
		);
	});

	it('onStudyEvent needs the study-event hook', () => {
		expect(() => createPluginSdk(bare).onStudyEvent(() => undefined)).toThrow(PermissionError);
	});

	it('record rejects a type the manifest does not declare', () => {
		expect(() => createPluginSdk(full).events.record('other', 3)).toThrow(/other/);
		expect(() => createPluginSdk(full).events.record('other', 3)).toThrow(PermissionError);
	});
});

describe('plugin sdk data', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('workspace get hits the keyed route with the workspace', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ key: 'k', data: { a: 1 } }));
		expect(await createPluginSdk(full).data.workspace(3).get('k')).toEqual({ a: 1 });
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/k?workspace=3');
	});

	it('404 is null and a JSON-text string is decoded', async () => {
		const scope = createPluginSdk(full).data.workspace(3);
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 404 }));
		expect(await scope.get('k')).toBeNull();
		vi.mocked(fetch).mockResolvedValue(json({ data: '{"a":1}' }));
		expect(await scope.get('k')).toEqual({ a: 1 });
	});

	it('a plain string round-trips instead of reading back as null', async () => {
		const scope = createPluginSdk(full).data.workspace(3);
		vi.mocked(fetch).mockResolvedValue(json({}));
		await scope.put('k', 'hello');
		expect(JSON.parse(String(lastCall().init.body))).toBe('hello');
		vi.mocked(fetch).mockResolvedValue(json({ data: 'hello' }));
		expect(await scope.get('k')).toBe('hello');
		vi.mocked(fetch).mockResolvedValue(json({ data: '{oops' }));
		expect(await scope.get('k')).toBe('{oops');
	});

	it('rejects empty, dot and dot-dot keys before any request', async () => {
		const scope = createPluginSdk(full).data.workspace(3);
		vi.mocked(fetch).mockClear();
		for (const key of ['', '.', '..']) {
			await expect(scope.get(key)).rejects.toThrow(/key/);
			await expect(scope.put(key, 1)).rejects.toThrow(/key/);
			await expect(scope.delete(key)).rejects.toThrow(/key/);
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('user scope has no workspace parameter and keys are escaped', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ data: 1 }));
		await createPluginSdk(full).data.user().get('a b/c');
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/a%20b%2Fc');
		expect(lastCall().url).not.toContain('workspace=');
	});

	it('keeps a colon readable in a key and rethrows other failures', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ data: 1 }));
		await createPluginSdk(full).data.workspace(3).get('entry:a');
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/entry:a?workspace=3');
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(createPluginSdk(full).data.user().get('k')).rejects.toThrow();
	});

	it('list uses the prefix route and maps rows', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json([{ key: 'entry:a', data: { x: 1 }, version: 2, updatedAt: 't' }])
		);
		const rows = await createPluginSdk(full).data.workspace(3).list('entry:');
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data?workspace=3&prefix=entry%3A');
		expect(rows).toEqual([{ key: 'entry:a', data: { x: 1 }, version: 2, updatedAt: 't' }]);
	});

	it('delete resolves on 404', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
		await expect(createPluginSdk(full).data.workspace(3).delete('k')).resolves.toBeUndefined();
		expect(lastCall().init.method).toBe('DELETE');
	});

	it('put sends the JSON body and passes keepalive', async () => {
		vi.mocked(fetch).mockResolvedValue(json({}));
		await createPluginSdk(full).data.workspace(3).put('k', { v: 1 }, { keepalive: true });
		expect(lastCall().init.method).toBe('PUT');
		expect(lastCall().init.keepalive).toBe(true);
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ v: 1 });
	});
});

describe('plugin sdk events', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('list spans workspaces and filters by type client-side', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json([
				{ id: '1', type: 'read' },
				{ id: '2', type: 'review' }
			])
		);
		const rows = await createPluginSdk(full).events.list({ types: ['read'] });
		expect(lastCall().url).toBe('/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z');
		expect(rows.map((r) => r.id)).toEqual(['1']);
	});

	it('list URL-encodes since', async () => {
		vi.mocked(fetch).mockResolvedValue(json([]));
		await createPluginSdk(full).events.list({ since: '2026-11-15T10:00:00+01:00', workspace: 2 });
		expect(lastCall().url).toBe(
			'/api/events?limit=2000&since=2026-11-15T10%3A00%3A00%2B01%3A00&workspace=2'
		);
	});

	it('list follows the pages of the log, repeating the workspace', async () => {
		const item = (id: string, type: string) => ({ id, userId: 1, workspaceId: 2, device: 'web', ts: '2026-01-01T00:00:00Z', type, payload: null });
		vi.mocked(fetch)
			.mockResolvedValueOnce(json({ events: [item('a', 'read')], more: true, next: 'e1.n' }))
			.mockResolvedValueOnce(json({ events: [item('b', 'review'), item('c', 'read')], more: false, next: null }));
		const rows = await createPluginSdk(full).events.list({ workspace: 2, types: ['read'] });
		expect(lastCall().url).toBe('/api/events?page=e1.n&workspace=2');
		expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
	});

	it('record posts one ULID event with device web and the given time', async () => {
		vi.mocked(fetch).mockResolvedValue(json({}));
		const at = new Date('2026-11-15T10:00:00Z');
		await createPluginSdk(full).events.record('journal', 3, { entryId: 'E' }, at);
		const { url, init } = lastCall();
		expect(url).toBe('/api/events/batch');
		const [event] = JSON.parse(String(init.body)).events;
		expect(event).toMatchObject({
			workspaceId: 3,
			device: 'web',
			type: 'journal',
			ts: at.toISOString(),
			payload: { entryId: 'E' }
		});
		expect(event.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('record rejects when the POST fails', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(createPluginSdk(full).events.record('journal', 3)).rejects.toThrow();
	});
});
