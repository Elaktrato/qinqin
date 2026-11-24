import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPLANATION_LANGUAGES } from './languages';
import { ENTRY_MAX_CHARS, ENTRY_TITLE_MAX } from './editorLogic';
import { DEFAULT_SETTINGS, parseEntry, parseSettings } from './store';

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../docs/contracts/journal/entries.json'), 'utf8')
) as {
	entry: Record<string, unknown>;
	limits: { guidanceCodePoints: number; textCodePoints: number; titleCodePoints: number };
	settings: {
		defaults: unknown;
		explanationLanguages: string[];
		reads: { name: string; stored: unknown; expect: unknown }[];
	};
};

describe('docs/contracts/journal/entries.json', () => {
	it('decodes the entry as the server answers it', () => {
		expect(parseEntry(fixture.entry)).toEqual(fixture.entry);
	});

	it('caps the entry textarea at the server limit (UTF-16 units are never fewer than code points)', () => {
		expect(ENTRY_MAX_CHARS).toBe(fixture.limits.textCodePoints);
		expect(ENTRY_TITLE_MAX).toBe(fixture.limits.titleCodePoints);
	});

	it('offers exactly the listed explanation languages', () => {
		expect(EXPLANATION_LANGUAGES.map((l) => l.code)).toEqual(fixture.settings.explanationLanguages);
	});

	it('has the documented defaults', () => {
		expect(DEFAULT_SETTINGS).toEqual(fixture.settings.defaults);
		expect(parseSettings(undefined)).toEqual(fixture.settings.defaults);
	});

	it.each(fixture.settings.reads)('settings: $name', ({ stored, expect: want }) => {
		expect(parseSettings(stored)).toEqual(want);
	});

	it('cuts guidance at the documented length', () => {
		const long = 'g'.repeat(fixture.limits.guidanceCodePoints + 5);
		expect([...parseSettings({ guidance: long, explanationLanguage: 'en' }).guidance]).toHaveLength(fixture.limits.guidanceCodePoints);
	});
});
