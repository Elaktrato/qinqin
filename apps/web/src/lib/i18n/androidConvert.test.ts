import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert, resourceName } from '../../../scripts/i18n-android.mjs';

// The reference converter beside the shared fixture android-convert.json (contract.test.ts): names, refusals
// and the command line. The scripts/ folder is outside vitest's include, so its test lives here.

describe('resourceName', () => {
	it('joins the segments with _', () => {
		expect(resourceName('settings.account.interfaceLanguage.label')).toBe('settings_account_interfaceLanguage_label');
	});
});

describe('convert', () => {
	it('refuses a message outside the syntax', () => {
		expect(() => convert({ 'app.bad': 'a {' }, { 'app.bad': 'a {' }, {})).toThrow(/app\.bad/);
	});

	it('an empty catalogue is an empty resources file', () => {
		expect(convert({}, {}, {})).toBe('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n');
	});
});

describe('command line', () => {
	it('prints strings.xml for a catalogue, English and notes', () => {
		const dir = mkdtempSync(join(tmpdir(), 'i18n-android-'));
		writeFileSync(join(dir, 'de.json'), JSON.stringify({ 'app.hello': 'Hallo {name}' }));
		writeFileSync(join(dir, 'en.json'), JSON.stringify({ 'app.hello': 'Hello {name}' }));
		writeFileSync(join(dir, 'notes.json'), JSON.stringify({ 'app.hello': 'A greeting' }));
		const script = resolve(__dirname, '../../../scripts/i18n-android.mjs');
		const out = execFileSync(process.execPath, [script, join(dir, 'de.json'), join(dir, 'en.json'), join(dir, 'notes.json')], {
			encoding: 'utf8'
		});
		expect(out).toBe(
			'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- A greeting -->\n    <string name="app_hello">Hallo %1$s</string>\n</resources>\n'
		);
	});
});
