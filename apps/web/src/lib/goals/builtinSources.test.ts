import { describe, expect, it } from 'vitest';
import { BUILTIN_SOURCES } from './builtinSources';

describe('BUILTIN_SOURCES', () => {
	it('are the built-in manifests activity rules, as the route lists them', () => {
		expect(BUILTIN_SOURCES).toEqual([
			{ type: 'review', plugin: 'qinqin-flashcards', label: 'Flashcard reviews', unit: 'count', describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' } },
			{ type: 'journal', plugin: 'qinqin-journal', label: 'Journal entries', unit: 'count', describe: { one: '{n} journal entry', other: '{n} journal entries' } },
			{ type: 'read', plugin: 'qinqin-reader', label: 'Reading', unit: 'seconds', describe: { one: '{n} minute of reading', other: '{n} minutes of reading' } }
		]);
	});
});
