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

	it('events.record needs write:study-events', () => {
		expect(() => createPluginSdk(bare).events.record('journal', 1)).toThrow(
			/qinqin-bare.*write:study-events/
		);
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

	it('the scopes are the keyed rows of the plugin namespace (lib/sync/keyed.ts)', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ key: 'k', data: '{"a":1}' }));
		expect(await createPluginSdk(full).data.workspace(3).get('k')).toEqual({ a: 1 });
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/k?workspace=3');
		vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
		await createPluginSdk(full).data.user().delete('entry:a');
		expect(lastCall().url).toBe('/api/plugins/qinqin-test/data/entry:a');
		expect(lastCall().init.method).toBe('DELETE');
	});
});

describe('plugin sdk events', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

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
