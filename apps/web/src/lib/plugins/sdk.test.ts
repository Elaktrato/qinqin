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

	it('404 is null, a string is decoded, an unparsable string is null', async () => {
		const scope = createPluginSdk(full).data.workspace(3);
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 404 }));
		expect(await scope.get('k')).toBeNull();
		vi.mocked(fetch).mockResolvedValue(json({ data: '{"a":1}' }));
		expect(await scope.get('k')).toEqual({ a: 1 });
		vi.mocked(fetch).mockResolvedValue(json({ data: '{oops' }));
		expect(await scope.get('k')).toBeNull();
	});

	it('user scope has no workspace parameter and keys are escaped', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ data: 1 }));
		await createPluginSdk(full).data.user().get('a b/c');
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/a%20b%2Fc');
		expect(lastCall().url).not.toContain('workspace=');
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
		expect(lastCall().url).toBe('/api/events?since=1970-01-01T00:00:00Z');
		expect(rows.map((r) => r.id)).toEqual(['1']);
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
