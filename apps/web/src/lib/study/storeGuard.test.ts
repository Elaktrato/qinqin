import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// A forged key builder: the keyed-row writers would now name a typed family.
vi.mock('./knownMarks', async (orig) => ({
	...(await orig<typeof import('./knownMarks')>()),
	knownMarkKey: () => 'card:forged',
	knownMarkRow: () => ({ key: 'card:forged', data: { version: 1, entryId: 5, createdAt: 't' } })
}));

import { setKnownMark, setKnownMarks } from './store';
import { pagedPull } from './testing/legacyCodec';

function calls(): string[] {
	return vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`);
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(pagedPull({ pluginData: [] })), { headers: { 'content-type': 'application/json' } }))
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

// The one-storage guard: the plugin-data writers refuse a typed-family key
// before anything is sent (docs/contracts/study/).
describe('assertKeyedRow', () => {
	it('a PUT of a typed-family key is refused with no request', async () => {
		await expect(setKnownMark(7, 5, true)).rejects.toThrow(/typed study row/);
		await expect(setKnownMark(7, 5, false)).rejects.toThrow(/typed study row/);
		expect(calls()).toEqual([]);
	});

	it('a keyed-row push of a typed-family key is refused before any push', async () => {
		await expect(setKnownMarks(7, [5], true)).rejects.toThrow(/typed study row/);
		expect(calls().filter((c) => !c.startsWith('GET /api/sync/pull'))).toEqual([]);
	});
});
