import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/images/resolve.json';
import { indexOf, resolvePicture } from './imagesIndex';

// docs/contracts/images/resolve.json: the offline lookup picks the picture the server picks (#274).
interface Case {
	name: string;
	language: string;
	targets: string[];
	sense: number;
	skip?: { packId: string; concept: string }[];
	pack: string | null;
	concept: string | null;
}

const indexes = fixture.packs
	.filter((p) => p.live)
	.map((p) =>
		indexOf(
			p.packId,
			'CC BY-SA 4.0',
			'x',
			p.pictures.map((c) => ({ concept: c, label: c, credit: 'c', svg: '<svg/>' })),
			p.map.map((m) => ({ ...m, basis: 'manual' }))
		)
	);

describe('docs/contracts/images/resolve.json (resolvePicture)', () => {
	it('has the cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(18));
	for (const c of fixture.cases as Case[]) {
		it(c.name, () => {
			const got = resolvePicture(indexes, c.language, c.targets, c.sense, c.skip ?? []);
			expect(got === null ? null : [got.packId, got.concept]).toEqual(c.concept === null ? null : [c.pack, c.concept]);
		});
	}
});
