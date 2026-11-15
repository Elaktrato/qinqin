import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('$lib/api/client', async (original) => ({
	...(await original<typeof import('$lib/api/client')>()),
	api
}));

import {
	GRAMMAR_PLUGIN_ID,
	loadProgress,
	parseProgress,
	progressKey,
	saveProgress
} from './progress';

beforeEach(() => api.mockReset());

describe('progress', () => {
	it('builds the key', () => {
		expect(progressKey('p', 'shi')).toBe('lesson:p:shi');
		expect(GRAMMAR_PLUGIN_ID).toBe('qinqin-grammar');
	});

	it('parses valid and rejects invalid values', () => {
		expect(parseProgress({ completedAt: 'x', best: 3, total: 8 })).toEqual({
			completedAt: 'x',
			best: 3,
			total: 8
		});
		expect(parseProgress(null)).toBeNull();
		expect(parseProgress({ completedAt: 'x', best: '3', total: 8 })).toBeNull();
		expect(parseProgress({ completedAt: 'x', best: 9, total: 8 })).toBeNull();
		expect(parseProgress({ completedAt: 'x', best: -1, total: 8 })).toBeNull();
	});

	it('loads the workspace rows by prefix, skipping junk', async () => {
		const good = { completedAt: 'x', best: 2, total: 4 };
		api.mockResolvedValue([
			{ key: 'lesson:p:a', data: good, version: 1, updatedAt: 'y' },
			{ key: 'lesson:p:e', data: JSON.stringify(good), version: 1, updatedAt: 'y' },
			{ key: 'lesson:p:f', data: 'nope', version: 1, updatedAt: 'y' },
			{ key: 'lesson:p:g', data: { best: 1 }, version: 1, updatedAt: 'y' }
		]);
		const map = await loadProgress(7);
		expect([...map.keys()].sort()).toEqual(['lesson:p:a', 'lesson:p:e']);
		expect(api.mock.calls[0][0]).toBe('/api/plugins/qinqin-grammar/data?workspace=7&prefix=lesson%3A');
	});

	it('keeps the best score', async () => {
		api.mockResolvedValue(undefined);
		const first = await saveProgress(7, 'p', 'a', 7, 8, null);
		expect(first.best).toBe(7);
		const second = await saveProgress(7, 'p', 'a', 5, 8, first);
		expect(second.best).toBe(7);
		expect(second.total).toBe(8);
		const [path, options] = api.mock.calls[1];
		expect(path).toBe('/api/plugins/qinqin-grammar/data/lesson:p:a?workspace=7');
		expect(options.method).toBe('PUT');
		expect(options.body.best).toBe(7);
	});
});
