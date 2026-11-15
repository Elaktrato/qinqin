import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('$lib/api/client', () => ({ api }));

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

	it('loads this plugin and workspace only, skipping tombstones and junk', () => {
		const good = { completedAt: 'x', best: 2, total: 4 };
		api.mockResolvedValue({
			pluginData: [
				{ pluginId: 'qinqin-grammar', key: 'lesson:p:a', workspaceId: 7, data: good },
				{ pluginId: 'qinqin-grammar', key: 'lesson:p:b', workspaceId: 8, data: good },
				{ pluginId: 'other', key: 'lesson:p:c', workspaceId: 7, data: good },
				{ pluginId: 'qinqin-grammar', key: 'lesson:p:d', workspaceId: 7, data: good, deletedAt: 'y' },
				{ pluginId: 'qinqin-grammar', key: 'lesson:p:e', workspaceId: 7, data: JSON.stringify(good) },
				{ pluginId: 'qinqin-grammar', key: 'lesson:p:f', workspaceId: 7, data: 'nope' },
				{ pluginId: 'qinqin-grammar', key: 'misc', workspaceId: 7, data: good }
			]
		});
		return loadProgress(7).then((map) => {
			expect([...map.keys()].sort()).toEqual(['lesson:p:a', 'lesson:p:e']);
		});
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
