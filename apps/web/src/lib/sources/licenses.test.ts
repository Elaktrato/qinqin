import { describe, expect, it } from 'vitest';
import { licenseUrl } from './licenses';

const BY4 = 'https://creativecommons.org/licenses/by/4.0/';
const BY3 = 'https://creativecommons.org/licenses/by/3.0/';
const BYSA4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const BYSA3 = 'https://creativecommons.org/licenses/by-sa/3.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const UNICODE = 'https://www.unicode.org/license.txt';
const OFL = 'https://openfontlicense.org/';

describe('licenseUrl', () => {
	it.each([
		['CC BY 4.0', BY4],
		['CC-BY-4.0', BY4],
		['CC BY 3.0', BY3],
		['CC-BY-3.0', BY3],
		['CC BY-SA 4.0', BYSA4],
		['CC-BY-SA-4.0', BYSA4],
		['CC BY-SA 3.0', BYSA3],
		['CC-BY-SA-3.0', BYSA3],
		['CC0', CC0],
		['CC0 1.0', CC0],
		['CC0-1.0', CC0],
		['Unicode License v3', UNICODE],
		['Unicode-3.0', UNICODE],
		['OFL-1.1', OFL],
		['SIL OFL 1.1', OFL]
	])('links %s', (name, url) => {
		expect(licenseUrl(name)).toBe(url);
	});

	it('ignores case and surrounding or repeated spaces', () => {
		expect(licenseUrl('  cc  by-sa   4.0 ')).toBe(BYSA4);
		expect(licenseUrl('cc0-1.0')).toBe(CC0);
	});

	it.each([
		'',
		'   ',
		'Unicode License v3 (fixture)',
		'CC BY-NC 4.0',
		'CC BY-SA',
		'CC BY-SA 4.0 or later',
		'per file',
		'EDRDG Licence',
		'see https://example.com/licence',
		'L',
		'OFL',
		'OFL-1.0'
	])('keeps %j plain', (name) => {
		expect(licenseUrl(name)).toBeNull();
	});
});
