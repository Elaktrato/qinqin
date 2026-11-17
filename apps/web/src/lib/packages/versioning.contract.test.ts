import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/packages/versioning.json';
import { packageAction } from './versioning';

interface ClientCase {
	kind: string;
	name: string;
	installed: { revision: number; contentHash: string; formatVersion: number } | null;
	row: { state: string; revision: number; formatVersion: number; contentHash: string };
	knownFormats: number[];
	localInstance: string | null;
	remoteInstance: string;
	action: string;
}
const cases = (fixture.cases as { kind: string }[]).filter((c) => c.kind === 'client') as ClientCase[];

describe('docs/contracts/packages/versioning.json client cases (packageAction)', () => {
	it('has the cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(18);
		for (const action of ['keep', 'download', 'delete', 'wait', 'unsupported', 'reset']) expect(cases.some((c) => c.action === action), action).toBe(true);
		expect(fixture.actions).toContain('reset');
	});
	for (const c of cases) {
		it(`${c.action}: ${c.name}`, () => {
			expect(packageAction(c.installed, c.row as never, c.knownFormats, c.localInstance, c.remoteInstance)).toBe(c.action);
		});
	}
});
