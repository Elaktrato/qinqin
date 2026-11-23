import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/packages/pack-types.json';
import { PACK_TYPE_LABELS, groupPacks } from '$lib/settings/packsView';
import type { InstalledPack, PackType } from '$lib/api/packs';

// docs/contracts/packages/pack-types.json: the web knows every pack type the
// server has (#172).
const types = fixture.types.map((t) => t.type);

describe('pack-types.json', () => {
	it('has a label for every pack type in the Data list', () => {
		expect(Object.keys(PACK_TYPE_LABELS).sort()).toEqual([...types].sort());
	});

	it('groups the Data list in the contract order', () => {
		const list = [...types].reverse().map((type) => ({ type: type as PackType, packId: type }) as InstalledPack);
		expect(groupPacks(list).map((g) => g.type)).toEqual(types);
	});
});
