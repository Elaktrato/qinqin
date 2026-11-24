import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({ api: vi.fn() }));

import { api } from '$lib/api/client';
import { logChangingTypes } from './contract';
import { PluginStates } from './states.svelte';

const mocked = vi.mocked(api);
const pluginStatesValue = (p: PluginStates) => ({ list: p.list, status: p.status });
let alive = true;
let states: PluginStates;

beforeEach(() => {
	mocked.mockReset();
	alive = true;
	states = new PluginStates({ api, alive: () => alive });
});

describe('plugin states (the session\'s)', () => {
	it('loads the list and becomes ready', async () => {
		const list = [{ id: 'qinqin-reader', manifest: {}, enabled: true, order: 1 }];
		mocked.mockResolvedValue(list);

		const pending = states.load();
		expect(states.status).toBe('loading');
		await pending;

		expect(mocked).toHaveBeenCalledWith('/api/plugins');
		expect(pluginStatesValue(states)).toEqual({ list, status: 'ready' });
	});

	it('ends in error with an empty list without throwing', async () => {
		mocked.mockRejectedValue(new Error('boom'));

		await expect(states.load()).resolves.toBeUndefined();

		expect(pluginStatesValue(states)).toEqual({ list: [], status: 'error' });
	});

	it('holds the listed manifests for logChangingTypes; a new session starts without them', async () => {
		mocked.mockResolvedValue([
			{ id: 'zz', manifest: { id: 'zz', sdk: 1, events: [{ type: 'drill', activity: { label: 'Drill', describe: { one: '{n}', other: '{n}' } } }] }, enabled: false, order: 0 }
		]);
		await states.load();
		expect(logChangingTypes(states.manifests).has('drill')).toBe(true);

		const next = new PluginStates({ api, alive: () => true });
		expect(pluginStatesValue(next)).toEqual({ list: [], status: 'idle' });
		expect(logChangingTypes(next.manifests).has('drill')).toBe(false);
	});

	it('an answer after the session ended sets nothing', async () => {
		let release!: (list: unknown) => void;
		mocked.mockReturnValue(new Promise((r) => (release = r)) as never);
		const pending = states.load();
		alive = false;
		release([{ id: 'qinqin-reader', manifest: {}, enabled: true, order: 1 }]);
		await pending;
		expect(states.status).toBe('loading');
		expect(states.manifests).toBeNull();
	});
});
