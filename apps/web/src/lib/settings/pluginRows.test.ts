import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import type { PluginInfo } from '../api/types';
import { builtinManifests } from '../plugins/contract';
import { webPlugins } from '../plugins';
import { pluginRowInfo } from './pluginRows';

function info(manifest: Record<string, unknown>): PluginInfo {
	return { id: String(manifest.id), manifest: manifest as PluginInfo['manifest'], enabled: true, order: 0 };
}

const journal = builtinManifests().find((m) => m.id === 'qinqin-journal')!;

describe('pluginRowInfo', () => {
	it('lists the journal permissions and needs no update', () => {
		expect(pluginRowInfo(info({ ...journal }), webPlugins)).toEqual({
			permissions: 'Stores its own data · Records study activity',
			needsUpdate: false
		});
	});

	it('flags a feature plugin without a web module', () => {
		const row = pluginRowInfo(
			info({ ...journal, id: 'qinqin-extra', permissions: ['owns-data'] }),
			webPlugins
		);
		expect(row).toEqual({ permissions: 'Stores its own data', needsUpdate: true });
	});

	it('flags a feature manifest with an unsupported sdk', () => {
		expect(pluginRowInfo(info({ ...journal, sdk: 2 }), webPlugins).needsUpdate).toBe(true);
	});

	it('leaves a dictionary pack alone', () => {
		expect(pluginRowInfo(info({ id: 'cedict', name: 'CC-CEDICT', type: 'dictionary' }), webPlugins)).toEqual({
			permissions: '',
			needsUpdate: false
		});
	});
});
