import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../docs/contracts/version/bridge-compat.json';
import { bridgeCompatibility, getVersion, type Bridge } from './version';

vi.mock('./client', () => ({ api: vi.fn(async () => ({ app: 'qinqin', version: '0.6.0', contract: 1, bridge: { level: 1, features: [] } })) }));

describe('bridgeCompatibility (docs/contracts/version/bridge-compat.json)', () => {
	it.each(fixture.cases)('$name', (c) => {
		expect(bridgeCompatibility(c.server as Bridge, c.shell as Bridge)).toEqual(c.want);
	});
});

describe('getVersion', () => {
	it('reads GET /api/version', async () => {
		const { api } = await import('./client');
		expect((await getVersion()).app).toBe('qinqin');
		expect(api).toHaveBeenCalledWith('/api/version');
	});
});
