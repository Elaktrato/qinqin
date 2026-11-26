import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A self-hosted server often has a certificate from a private CA (Caddy's internal CA, headscale setups). Since
// Android 7 an app trusts user-installed CAs only when its network security config says so; without it the first-run
// screen's own advice ("install the certificate authority") would never work.
const xml = readFileSync(
	new URL('../android/app/src/main/res/xml/network_security_config.xml', import.meta.url),
	'utf8'
).replace(/<!--[\s\S]*?-->/g, '');

describe('network security config', () => {
	it('trusts the system store and the CAs the user installed', () => {
		expect(xml).toContain('<certificates src="system"/>');
		expect(xml).toContain('<certificates src="user"/>');
	});
	it('does not pin or trust everything', () => {
		expect(xml).not.toMatch(/<pin-set|<pin /);
		expect(xml).not.toMatch(/src="@raw/);
	});
});
