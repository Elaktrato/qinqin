import { describe, expect, it } from 'vitest';
import apacheShipped from '../../static/OPENCC-APACHE-2.0.TXT?raw';
import mitShipped from '../../static/OPENCC-JS-LICENSE.TXT?raw';
import apacheUpstream from '../../node_modules/opencc-js/LICENSES/Apache-2.0.txt?raw';
import mitUpstream from '../../node_modules/opencc-js/LICENSE?raw';

// The licence texts the app serves for bundled third-party code must be
// the package's own files, byte for byte (copied, never retyped).
describe('third-party licence texts', () => {
	it('ships the opencc-js MIT licence verbatim', () => {
		expect(mitShipped).toBe(mitUpstream);
	});

	it('ships the opencc-js dictionary data Apache-2.0 licence verbatim', () => {
		expect(apacheShipped).toBe(apacheUpstream);
		expect(apacheShipped).toContain('Apache License');
	});
});
