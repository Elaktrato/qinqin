/**
 * Licence links (#17). A licence name is linked only when it is exactly one
 * of the SPDX ids or common written names below (case and spacing aside):
 * free-text names, unknown versions and "per file" stay plain text, so a
 * name can never be linked to the wrong licence.
 */

const BY4 = 'https://creativecommons.org/licenses/by/4.0/';
const BY3 = 'https://creativecommons.org/licenses/by/3.0/';
const BYSA4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const BYSA3 = 'https://creativecommons.org/licenses/by-sa/3.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const UNICODE = 'https://www.unicode.org/license.txt';
const OFL = 'https://openfontlicense.org/';

const KNOWN: ReadonlyMap<string, string> = new Map([
	['cc by 4.0', BY4],
	['cc-by-4.0', BY4],
	['cc by 3.0', BY3],
	['cc-by-3.0', BY3],
	['cc by-sa 4.0', BYSA4],
	['cc-by-sa-4.0', BYSA4],
	['cc by-sa 3.0', BYSA3],
	['cc-by-sa-3.0', BYSA3],
	['cc0', CC0],
	['cc0 1.0', CC0],
	['cc0-1.0', CC0],
	['unicode license v3', UNICODE],
	['unicode-3.0', UNICODE],
	['ofl-1.1', OFL],
	['sil ofl 1.1', OFL]
]);

/** licenseUrl is the canonical licence text URL of a recognised licence name, else null. */
export function licenseUrl(name: string): string | null {
	return KNOWN.get(name.trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}
