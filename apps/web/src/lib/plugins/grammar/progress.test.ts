import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, FakeApiError } = vi.hoisted(() => ({
	api: vi.fn(),
	// One class for the SDK (instanceof) and the tests, whatever the module graph does.
	FakeApiError: class extends Error {
		constructor(
			public status: number,
			message: string
		) {
			super(message);
		}
	}
}));
vi.mock('$lib/api/client', async (original) => ({
	...(await original<typeof import('$lib/api/client')>()),
	api,
	ApiError: FakeApiError
}));

const ApiError = FakeApiError;

import type { Progress } from './types';
import {
	GRAMMAR_PLUGIN_ID,
	loadProgress,
	parseProgress,
	progressKey,
	recordRun,
	saveProgress
} from './progress';
import { dataRow } from '../../testing/keyed';

beforeEach(() => {
	api.mockReset();
});

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
			dataRow({ key: 'lesson:p:a', data: good }),
			dataRow({ key: 'lesson:p:e', data: JSON.stringify(good) }),
			dataRow({ key: 'lesson:p:f', data: 'nope' }),
			dataRow({ key: 'lesson:p:g', data: { best: 1 } })
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

	it('resets the best when the lesson changed size', async () => {
		api.mockResolvedValue(undefined);
		const stored: Progress = { completedAt: 'x', best: 8, total: 8 };
		const next = await saveProgress(7, 'p', 'a', 4, 6, stored);
		expect(next).toMatchObject({ best: 4, total: 6 });
	});
});

describe('recordRun (the real load and save path)', () => {
	const put = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT');

	it('reads the stored row first and keeps the better best', async () => {
		api.mockImplementation(async (_path: string, o?: { method?: string }) =>
			o?.method === 'PUT' ? undefined : { data: { completedAt: 'x', best: 7, total: 8 } }
		);
		const saved = await recordRun(7, 'p', 'a', 5, 8);
		expect(saved).toMatchObject({ best: 7, total: 8 });
		expect(put()).toHaveLength(1);
		expect(put()[0][1].body.best).toBe(7);
	});

	it('does not save when the stored score cannot be loaded', async () => {
		api.mockImplementation((_path: string, o?: { method?: string }) =>
			o?.method === 'PUT' ? Promise.resolve(undefined) : Promise.reject(new ApiError(500, 'boom'))
		);
		let caught: unknown = null;
		try {
			await recordRun(7, 'p', 'a', 3, 8);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect(put()).toHaveLength(0);
	});

	it('saves the first run when there is no stored row', async () => {
		api.mockImplementation((_path: string, o?: { method?: string }) =>
			o?.method === 'PUT' ? Promise.resolve(undefined) : Promise.reject(new ApiError(404, 'not found'))
		);
		const saved = await recordRun(7, 'p', 'a', 3, 8);
		expect(saved).toMatchObject({ best: 3, total: 8 });
		expect(put()).toHaveLength(1);
	});

	it('starts over when the stored row is for a different lesson size', async () => {
		api.mockImplementation(async (_path: string, o?: { method?: string }) =>
			o?.method === 'PUT' ? undefined : { data: { completedAt: 'x', best: 8, total: 8 } }
		);
		const saved = await recordRun(7, 'p', 'a', 4, 6);
		expect(saved).toMatchObject({ best: 4, total: 6 });
	});
});
