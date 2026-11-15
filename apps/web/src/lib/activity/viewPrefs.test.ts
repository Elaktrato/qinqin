import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import {
	ACTIVITY_VIEW_KEY,
	DEFAULT_ACTIVITY_VIEW,
	loadActivityView,
	parseActivityView,
	saveActivityView
} from './viewPrefs';

describe('parseActivityView', () => {
	it('round-trips a valid value', () => {
		expect(parseActivityView({ version: 1, scope: 'all', hidden: ['read'] })).toEqual({
			scope: 'all',
			hidden: ['read']
		});
		expect(parseActivityView({ version: 1, scope: 'workspace', hidden: [] })).toEqual({
			scope: 'workspace',
			hidden: []
		});
	});

	it('reads anything unusable as the default', () => {
		for (const bad of [null, undefined, 'x', 5, [], {}, { version: 2 }, { scope: 'galaxy' }]) {
			expect(parseActivityView(bad)).toEqual(DEFAULT_ACTIVITY_VIEW);
		}
		expect(DEFAULT_ACTIVITY_VIEW).toEqual({ scope: 'workspace', hidden: [] });
	});

	it('keeps the valid part of a damaged value', () => {
		expect(parseActivityView({ version: 1, scope: 'galaxy', hidden: ['read'] })).toEqual({
			scope: 'workspace',
			hidden: ['read']
		});
		expect(parseActivityView({ version: 1, scope: 'all', hidden: ['read', 3, null, 'read'] })).toEqual({
			scope: 'all',
			hidden: ['read']
		});
		expect(parseActivityView({ version: 1, scope: 'all', hidden: 'read' })).toEqual({
			scope: 'all',
			hidden: []
		});
	});
});

describe('view store', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('reads the user-global qinqin-core activity-view row', async () => {
		expect(ACTIVITY_VIEW_KEY).toBe('activity-view');
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify([{ key: 'activity-view', data: { version: 1, scope: 'all', hidden: ['journal'] } }]), {
				headers: { 'content-type': 'application/json' }
			})
		);
		expect(await loadActivityView()).toEqual({ scope: 'all', hidden: ['journal'] });
		expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
			'/api/plugins/qinqin-core/data?prefix=activity-view'
		);
	});

	it('loads the default when the row is missing or the server fails', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response('[]', { headers: { 'content-type': 'application/json' } })
		);
		expect(await loadActivityView()).toEqual(DEFAULT_ACTIVITY_VIEW);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // an empty list, no 404 request
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		expect(await loadActivityView()).toEqual(DEFAULT_ACTIVITY_VIEW);
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
		expect(await loadActivityView()).toEqual(DEFAULT_ACTIVITY_VIEW);
	});

	it('saves a version 1 value', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
		await saveActivityView({ scope: 'all', hidden: ['read'] });
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(String(url)).toBe('/api/plugins/qinqin-core/data/activity-view');
		expect((init as RequestInit).method).toBe('PUT');
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			version: 1,
			scope: 'all',
			hidden: ['read']
		});
	});
});
