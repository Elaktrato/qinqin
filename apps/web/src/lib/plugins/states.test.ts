import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/client', () => ({ api: vi.fn() }));

import { api } from '$lib/api/client';
import { logChangingTypes, setRegisteredManifests } from './contract';
import { loadPluginStates, pluginStates, resetPluginStates } from './states';

const mocked = vi.mocked(api);

beforeEach(() => {
	mocked.mockReset();
	resetPluginStates();
});

describe('plugin states store', () => {
	it('loads the list and becomes ready', async () => {
		const list = [{ id: 'qinqin-reader', manifest: {}, enabled: true, order: 1 }];
		mocked.mockResolvedValue(list);

		const pending = loadPluginStates();
		expect(get(pluginStates).status).toBe('loading');
		await pending;

		expect(mocked).toHaveBeenCalledWith('/api/plugins');
		expect(get(pluginStates)).toEqual({ list, status: 'ready' });
	});

	it('ends in error with an empty list without throwing', async () => {
		mocked.mockRejectedValue(new Error('boom'));

		await expect(loadPluginStates()).resolves.toBeUndefined();

		expect(get(pluginStates)).toEqual({ list: [], status: 'error' });
	});

	it('feeds the registered manifests to logChangingTypes, and drops them on reset', async () => {
		mocked.mockResolvedValue([
			{ id: 'zz', manifest: { id: 'zz', sdk: 1, events: [{ type: 'drill' }] }, enabled: false, order: 0 }
		]);
		await loadPluginStates();
		expect(logChangingTypes().has('drill')).toBe(true);

		resetPluginStates();
		expect(logChangingTypes().has('drill')).toBe(false);
		setRegisteredManifests(null);
	});

	it('reset returns to idle', async () => {
		mocked.mockResolvedValue([]);
		await loadPluginStates();

		resetPluginStates();

		expect(get(pluginStates)).toEqual({ list: [], status: 'idle' });
	});
});
