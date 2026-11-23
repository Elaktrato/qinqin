import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/packages/catalogue.json';
import { PACKAGE_ID, PACKAGE_TYPES, parseCatalogue } from './packages';

interface Case {
	name: string;
	valid: boolean;
	reason?: string;
	admin?: boolean;
	catalogue: unknown;
}
const cases = fixture.cases as Case[];

describe('docs/contracts/packages/catalogue.json', () => {
	for (const c of cases) {
		it(`${c.valid ? 'decodes' : 'refuses'}: ${c.name}${c.reason ? ` (${c.reason})` : ''}`, () => {
			const out = parseCatalogue(c.catalogue);
			if (c.valid) {
				expect(out).not.toBeNull();
				const raw = c.catalogue as { packages: { id: string; error?: string }[] };
				expect(out?.packages.map((p) => p.id)).toEqual(raw.packages.map((p) => p.id));
				expect(out?.packages.map((p) => p.error)).toEqual(raw.packages.map((p) => p.error));
			} else {
				expect(out).toBeNull();
			}
		});
	}

	it('knows every package type and the id grammar', () => {
		expect([...PACKAGE_TYPES]).toEqual(fixture.types);
		expect(PACKAGE_ID.source).toBe(fixture.idPattern);
	});

	it('refuses what is not an object', () => {
		for (const raw of [null, undefined, 'x', 3, [], true]) expect(parseCatalogue(raw)).toBeNull();
	});
});
