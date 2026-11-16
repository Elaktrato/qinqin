import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { fetchActivity } from './stats';

describe('fetchActivity', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('builds the URL and returns the body', async () => {
		const body = { from: '2026-08-15', to: '2026-11-13', timeZone: 'Asia/Tokyo', sources: [], cells: [] };
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
		);
		expect(await fetchActivity('2026-08-15', '2026-11-13')).toEqual(body);
		expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
			'/api/stats/activity?from=2026-08-15&to=2026-11-13'
		);
	});

	it('adds the workspace when given', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } })
		);
		await fetchActivity('2025-11-16', '2026-11-16', 3);
		expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
			'/api/stats/activity?from=2025-11-16&to=2026-11-16&workspace=3'
		);
	});

	it('rejects when the server fails', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(fetchActivity('2026-08-15', '2026-11-13')).rejects.toThrow();
	});
});
