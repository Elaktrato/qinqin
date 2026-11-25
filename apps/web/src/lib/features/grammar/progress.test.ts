import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('$lib/api/client', async (original) => ({
	...(await original<typeof import('$lib/api/client')>()),
	api
}));

import { loadProgress, parseProgress, parseProgressRow, progressKey, recordRun } from './progress';

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../docs/contracts/grammar/progress.json'), 'utf8')
) as { row: unknown; reads: { name: string; value: unknown; ok: boolean }[] };

beforeEach(() => {
	api.mockReset();
});

describe('docs/contracts/grammar/progress.json', () => {
	it('reads the documented row', () => {
		expect(parseProgressRow(fixture.row)).not.toBeNull();
	});

	it.each(fixture.reads)('$name', ({ value, ok }) => {
		expect(parseProgressRow(value) !== null).toBe(ok);
	});
});

describe('progress', () => {
	it('parses valid and rejects invalid values', () => {
		expect(parseProgress({ completedAt: 'x', best: 3, total: 8 })).toEqual({ completedAt: 'x', best: 3, total: 8 });
		expect(parseProgress(null)).toBeNull();
		expect(parseProgress({ completedAt: 'x', best: '3', total: 8 })).toBeNull();
		expect(parseProgress({ completedAt: 'x', best: -1, total: 8 })).toBeNull();
	});

	it("loads the workspace's rows by lesson, skipping junk", async () => {
		const good = { completedAt: 'x', best: 2, total: 4 };
		api.mockResolvedValue([
			{ packId: 'p', lessonId: 'a', ...good },
			{ packId: 'p', lessonId: 'e', ...good },
			{ packId: 'p', lessonId: 'f', completedAt: 'x', best: 9, total: 4 },
			'nope',
			{ lessonId: 'g', ...good }
		]);
		const map = await loadProgress(7);
		expect([...map.keys()].sort()).toEqual([progressKey('p', 'a'), progressKey('p', 'e')]);
		expect(api.mock.calls[0][0]).toBe('/api/grammar/progress?workspace=7');
	});

	it('records a run and answers what the server stored', async () => {
		api.mockResolvedValue({ packId: 'p', lessonId: 'a', completedAt: 'x', best: 7, total: 8 });
		expect(await recordRun(7, 'p', 'a', 5, 8)).toEqual({ completedAt: 'x', best: 7, total: 8 });
		const [path, options] = api.mock.calls[0];
		expect(path).toBe('/api/grammar/progress?workspace=7');
		expect(options).toMatchObject({ method: 'POST', body: { packId: 'p', lessonId: 'a', score: 5, total: 8 } });
	});

	it('throws when the request fails or the answer is no progress', async () => {
		api.mockRejectedValueOnce(new Error('boom'));
		await expect(recordRun(7, 'p', 'a', 3, 8)).rejects.toThrow('boom');
		api.mockResolvedValueOnce({ best: 1 });
		await expect(recordRun(7, 'p', 'a', 3, 8)).rejects.toThrow();
	});
});
