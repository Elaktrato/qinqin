import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/packages/pack-types.json';
import { PACK_TYPES, isDataPackPlugin } from './dataPacks';
import { PACK_TYPE_LABELS } from '$lib/settings/packsView';

// docs/contracts/packages/pack-types.json: the web knows every pack type the
// server has (#172), and leaves every one out of Settings → Plugins (#169).
const types = fixture.types.map((t) => t.type);

describe('pack-types.json', () => {
	it('lists the pack types the web filters out of the plugin list', () => {
		expect([...PACK_TYPES].sort()).toEqual([...types].sort());
		for (const type of types) {
			expect(isDataPackPlugin({ id: 'p', manifest: { id: 'p', type }, enabled: true, order: 0 }), type).toBe(true);
		}
	});

	it('has a label for every pack type in the Data list', () => {
		expect(Object.keys(PACK_TYPE_LABELS).sort()).toEqual([...types].sort());
	});

	it('hides the legacy rows: no client relies on them', () => {
		const legacy = fixture.types.filter((t) => t.legacyPluginRow).map((t) => t.type);
		expect(legacy).toEqual(['dictionary', 'frequency', 'levels', 'sentences', 'grammar', 'audio']);
	});
});
