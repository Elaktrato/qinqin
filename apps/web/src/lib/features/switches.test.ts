import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/client')>()), api: vi.fn() }));

import { api } from '$lib/api/client';
import { FeatureSwitches } from './switches.svelte';
import { coreFeatures, featureEnabled } from './index';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../docs/contracts/features/switches.json'), 'utf8')) as {
	features: string[];
	list: unknown[];
	reads: { name: string; list: unknown; enabled: Record<string, boolean> }[];
};

const mocked = vi.mocked(api);
const value = (p: FeatureSwitches) => ({ list: p.list, status: p.status });
let alive = true;
let switches: FeatureSwitches;

beforeEach(() => {
	mocked.mockReset();
	alive = true;
	switches = new FeatureSwitches({ api, alive: () => alive });
});

describe('docs/contracts/features/switches.json', () => {
	it('names the core features in the navigation order', () => {
		expect(coreFeatures.map((f) => f.id)).toEqual(fixture.features);
	});

	it.each(fixture.reads)('$name', async ({ list, enabled }) => {
		mocked.mockResolvedValue(list);
		await switches.load();
		for (const [id, on] of Object.entries(enabled)) expect(featureEnabled(id, switches.list), id).toBe(on);
	});
});

describe('feature switches (the session\'s)', () => {
	it('loads the list and becomes ready', async () => {
		mocked.mockResolvedValue(fixture.list);
		const pending = switches.load();
		expect(switches.status).toBe('loading');
		await pending;
		expect(mocked).toHaveBeenCalledWith('/api/features');
		expect(value(switches).status).toBe('ready');
		expect(switches.list.map((s) => s.id)).toEqual(fixture.features);
	});

	it('ends in error with an empty list without throwing', async () => {
		mocked.mockRejectedValue(new Error('boom'));
		await expect(switches.load()).resolves.toBeUndefined();
		expect(value(switches)).toEqual({ list: [], status: 'error' });
	});

	it('saves one switch and reloads', async () => {
		mocked.mockResolvedValueOnce({ id: 'journal', enabled: false, updatedAt: '2026-11-24T10:00:00Z' }).mockResolvedValueOnce([]);
		await switches.save('journal', false);
		expect(mocked.mock.calls[0]).toEqual(['/api/features/journal', { method: 'PUT', body: { enabled: false } }]);
		expect(mocked.mock.calls[1]).toEqual(['/api/features']);
	});

	it('keeps a late answer of an ended session out', async () => {
		let resolve!: (v: unknown) => void;
		mocked.mockReturnValue(new Promise((r) => (resolve = r)));
		const pending = switches.load();
		alive = false;
		resolve(fixture.list);
		await pending;
		expect(switches.status).toBe('loading');
	});
});
