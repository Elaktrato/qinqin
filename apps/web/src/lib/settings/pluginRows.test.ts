import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import type { PluginInfo } from '../api/types';
import { builtinManifests } from '../plugins/contract';
import { webPlugins } from '../plugins';
import { listedPlugins, pluginRowInfo, validOrder } from './pluginRows';

function info(manifest: Record<string, unknown>): PluginInfo {
	return { id: String(manifest.id), manifest: manifest as PluginInfo['manifest'], enabled: true, order: 0 };
}

const journal = builtinManifests().find((m) => m.id === 'qinqin-journal')!;

describe('listedPlugins (Settings -> Plugins)', () => {
	it('lists the plugins only: never the core row or the two core features, hidden or not', () => {
		const row = (id: string, hidden?: boolean): PluginInfo => ({ id, manifest: {}, enabled: true, order: 0, ...(hidden === undefined ? {} : { hidden }) });
		const list = [
			row('qinqin-core', true),
			row('qinqin-flashcards', false),
			row('qinqin-reader'),
			row('qinqin-journal'),
			row('qinqin-grammar'),
			row('some-hidden-builtin', true)
		];
		expect(listedPlugins(list).map((p) => p.id)).toEqual(['qinqin-journal', 'qinqin-grammar']);
	});
});

describe('pluginRowInfo', () => {
	it('lists the journal permissions and needs no update', () => {
		expect(pluginRowInfo(info({ ...journal }), webPlugins)).toEqual({
			permissions: 'Stores its own data · Records study activity',
			notice: null
		});
	});

	it('flags a feature plugin without a web module', () => {
		const row = pluginRowInfo(
			info({ ...journal, id: 'qinqin-extra', permissions: ['owns-data'] }),
			webPlugins
		);
		expect(row).toEqual({ permissions: 'Stores its own data', notice: 'app-update' });
	});

	it('flags a feature manifest with a newer sdk as an app update', () => {
		expect(pluginRowInfo(info({ ...journal, sdk: 2 }), webPlugins).notice).toBe('app-update');
	});

	it('flags a grandfathered row without sdk as legacy', () => {
		const { sdk: _sdk, ...legacy } = journal;
		expect(pluginRowInfo(info({ ...legacy, id: 'legacy-x' }), webPlugins).notice).toBe('legacy');
	});

	it('leaves a dictionary pack alone', () => {
		expect(pluginRowInfo(info({ id: 'cedict', name: 'CC-CEDICT', type: 'dictionary' }), webPlugins)).toEqual({
			permissions: '',
			notice: null
		});
	});
});

describe('validOrder', () => {
	it('accepts whole numbers of 0 or more only', () => {
		expect(validOrder(0)).toBe(true);
		expect(validOrder(7)).toBe(true);
		expect(validOrder(-1)).toBe(false);
		expect(validOrder(1.5)).toBe(false);
		expect(validOrder(Number.NaN)).toBe(false);
		expect(validOrder(null)).toBe(false);
		expect(validOrder(undefined)).toBe(false);
	});
});
