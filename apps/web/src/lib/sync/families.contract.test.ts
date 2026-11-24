import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROW_FAMILIES, rowFamilyOf } from './keyed';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../docs/contracts/keyed/families.json'), 'utf8')) as {
	families: { key: string; prefix: boolean; scope: string }[];
	cases: { name: string; key: string; scope: string; accept: boolean; answer?: string }[];
};

describe('docs/contracts/keyed/families.json', () => {
	it('lists exactly the families the client knows', () => {
		expect(ROW_FAMILIES.map((f) => ({ key: f.key, prefix: f.prefix, scope: f.scope }))).toEqual(
			fixture.families.map((f) => ({ key: f.key, prefix: f.prefix, scope: f.scope }))
		);
	});

	it.each(fixture.cases)('$name', ({ key, scope, accept, answer }) => {
		const family = rowFamilyOf(key);
		if (accept) {
			expect(family?.scope).toBe(scope);
		} else if (answer === 'unknown') {
			expect(family).toBeNull();
		} else {
			expect(family).not.toBeNull();
			expect(family?.scope).not.toBe(scope);
		}
	});
});
