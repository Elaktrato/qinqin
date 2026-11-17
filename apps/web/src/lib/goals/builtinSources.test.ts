import { describe, expect, it } from 'vitest';
import { BUILTIN_SOURCES } from './builtinSources';

describe('BUILTIN_SOURCES', () => {
	it('are the built-in manifests activity rules, as the route lists them', () => {
		expect(BUILTIN_SOURCES).toEqual([
			{ type: 'review', plugin: 'qinqin-core', label: 'Flashcard reviews', unit: 'count', describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' } },
			{ type: 'read', plugin: 'qinqin-core', label: 'Reading', unit: 'seconds', describe: { one: '{n} minute of reading', other: '{n} minutes of reading' } },
			{ type: 'journal', plugin: 'qinqin-journal', label: 'Journal entries', unit: 'count', describe: { one: '{n} journal entry', other: '{n} journal entries' } }
		]);
	});
});
