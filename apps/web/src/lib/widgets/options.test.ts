import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { find, put } = vi.hoisted(() => ({ find: vi.fn(), put: vi.fn() }));

vi.mock('$lib/sync/keyed', () => ({
	CORE_NAMESPACE: 'qinqin-core',
	keyedData: () => ({ find, put })
}));

import {
	HEATMAP_LAYOUTS,
	WIDGET_OPTIONS_KEY,
	loadWidgetOptions,
	parseWidgetOptions,
	saveHeatmapLayout,
	withHeatmapLayout,
	type HeatmapLayout
} from './options';

// docs/contracts/settings/widget-options.json: the qinqin-core row "widget-options".
const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/settings/widget-options.json'), 'utf8')
) as {
	key: string;
	layouts: string[];
	defaults: { 'activity-heatmap': { layout: string } };
	parse: { name: string; value: unknown; expect: HeatmapLayout }[];
	write: { name: string; stored: unknown; layout: HeatmapLayout; expect: unknown }[];
};

afterEach(() => {
	find.mockReset();
	put.mockReset();
});

describe('widget-options contract', () => {
	it('names the row and the layouts', () => {
		expect(WIDGET_OPTIONS_KEY).toBe(fixture.key);
		expect([...HEATMAP_LAYOUTS]).toEqual(fixture.layouts);
		expect(parseWidgetOptions(null).heatmapLayout).toBe(fixture.defaults['activity-heatmap'].layout);
	});

	it.each(fixture.parse.map((c) => [c.name, c] as const))('parse: %s', (_, c) => {
		expect(parseWidgetOptions(c.value).heatmapLayout).toBe(c.expect);
	});

	it.each(fixture.write.map((c) => [c.name, c] as const))('write: %s', (_, c) => {
		const before = JSON.stringify(c.stored);
		expect(withHeatmapLayout(c.stored, c.layout)).toEqual(c.expect);
		// The stored copy is never mutated.
		expect(JSON.stringify(c.stored)).toBe(before);
	});
});

describe('widget-options store', () => {
	it('loadWidgetOptions returns the default on a 200 with no rows', async () => {
		find.mockResolvedValue(null);
		const options = await loadWidgetOptions();
		expect(find).toHaveBeenCalledWith('widget-options');
		expect(options.heatmapLayout).toBe('garden');
	});

	it('loadWidgetOptions reads the stored layout', async () => {
		find.mockResolvedValue({ version: 1, 'activity-heatmap': { layout: 'week' } });
		expect((await loadWidgetOptions()).heatmapLayout).toBe('week');
	});

	it('a failed load rejects (the caller falls back to garden)', async () => {
		find.mockRejectedValue(new Error('offline'));
		await expect(loadWidgetOptions()).rejects.toThrow('offline');
	});

	it('saveHeatmapLayout re-reads the row and keeps keys written by another device since load', async () => {
		find.mockResolvedValue({ version: 1, 'daily-goal': { x: 1 }, 'activity-heatmap': { layout: 'garden', size: 'l' } });
		put.mockResolvedValue(undefined);
		await saveHeatmapLayout('month');
		expect(find).toHaveBeenCalledWith('widget-options');
		expect(put).toHaveBeenCalledWith('widget-options', {
			version: 1,
			'daily-goal': { x: 1 },
			'activity-heatmap': { layout: 'month', size: 'l' }
		});
	});

	it('saveHeatmapLayout writes nothing when the re-read fails', async () => {
		find.mockRejectedValue(new Error('offline'));
		await expect(saveHeatmapLayout('week')).rejects.toThrow('offline');
		expect(put).not.toHaveBeenCalled();
	});
});
