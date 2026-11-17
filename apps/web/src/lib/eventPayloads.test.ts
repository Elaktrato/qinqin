import { describe, expect, it } from 'vitest';

import payloadsFixture from '../../../../docs/contracts/events/payloads.json';
import * as builders from './eventPayloads';

interface BuildCase {
	kind: 'build';
	type: string;
	name: string;
	args: unknown[];
	expect: unknown;
}

const fixture = payloadsFixture as unknown as {
	rule: string;
	types: { type: string; write: boolean; builder?: string }[];
	cases: { kind: string }[];
};
const buildCases = fixture.cases.filter((c): c is BuildCase => c.kind === 'build');

describe('docs/contracts/events/payloads.json: builders', () => {
	it('has exactly one builder per written type and none for the others', () => {
		expect(fixture.rule).toBe('events/payloads');
		const named = fixture.types.filter((t) => t.write).map((t) => t.builder);
		expect(Object.keys(builders).sort()).toEqual([...named].sort());
		for (const t of fixture.types) {
			if (!t.write) expect(t.builder).toBeUndefined();
			expect(buildCases.some((c) => c.type === t.type)).toBe(t.write);
		}
	});
	for (const c of buildCases) {
		it(`${c.type}: ${c.name}`, () => {
			const builder = fixture.types.find((t) => t.type === c.type)!.builder as keyof typeof builders;
			const out = (builders[builder] as (...args: unknown[]) => unknown)(...c.args);
			expect(out).toEqual(c.expect);
			// Member order is part of the contract: the stored JSON text is compared.
			expect(JSON.stringify(out)).toBe(JSON.stringify(c.expect));
		});
	}
});
