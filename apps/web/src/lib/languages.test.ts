import { describe, expect, it } from 'vitest';
import type { Language, Workspace } from './api/types';
import { flagFor, languageLabel, languageOptions, usesHan, workspaceDisplay } from './languages';
import { installCatalogue, resetCatalogue } from './i18n';
import en from './i18n/messages/en.json';

function ws(id: number, language: string, name = ''): Workspace {
	return { id, language, name, settings: {}, updatedAt: '2026-01-01T00:00:00Z' };
}

function lang(code: string, name = code): Language {
	return { code, name, installed: true, kind: 'data' };
}

describe('languageLabel', () => {
	it('names common languages in English by default', () => {
		expect(languageLabel('zh')).toBe('Chinese');
		expect(languageLabel('ja')).toBe('Japanese');
		expect(languageLabel('es')).toBe('Spanish');
	});

	it('is case-insensitive and keeps region subtags', () => {
		expect(languageLabel('JA')).toBe('Japanese');
		expect(languageLabel('zh-TW')).toMatch(/^Chinese/);
	});

	it('follows the interface language by default', () => {
		installCatalogue('de', en);
		try {
			expect(languageLabel('ja')).toBe('Japanisch');
		} finally {
			resetCatalogue();
		}
	});

	it('honours an explicit locale', () => {
		expect(languageLabel('ja', 'de')).toBe('Japanisch');
	});

	it('falls back to the code for unknown or malformed codes', () => {
		expect(languageLabel('qqq')).toBe('qqq');
		expect(languageLabel('not a code!')).toBe('not a code!');
		expect(languageLabel('')).toBe('');
	});
});

describe('flagFor', () => {
	it('maps the bundled languages to their flags', () => {
		expect(flagFor('zh')).toBe('cn');
		expect(flagFor('ja')).toBe('jp');
		expect(flagFor('es')).toBe('es');
	});

	it('uses the primary subtag, case-insensitively', () => {
		expect(flagFor('zh-TW')).toBe('cn');
		expect(flagFor('ZH_hant')).toBe('cn');
		expect(flagFor('JA')).toBe('jp');
	});

	it('shows a globe for anything else', () => {
		expect(flagFor('jp')).toBe('globe');
		expect(flagFor('fr')).toBe('globe');
		expect(flagFor('')).toBe('globe');
	});
});

describe('usesHan', () => {
	it('is true for Chinese and Japanese only', () => {
		expect(usesHan('zh')).toBe(true);
		expect(usesHan('ja')).toBe(true);
		expect(usesHan('zh-TW')).toBe(true);
		expect(usesHan('JA')).toBe(true);
		expect(usesHan('es')).toBe(false);
		expect(usesHan('ko')).toBe(false);
		expect(usesHan('zhx')).toBe(false);
		expect(usesHan('')).toBe(false);
	});
});

describe('workspaceDisplay', () => {
	it('shows only the flag for the single unnamed workspace of a language', () => {
		const zh = ws(1, 'zh');
		const ja = ws(2, 'ja');
		expect(workspaceDisplay([zh, ja], zh)).toEqual({ label: 'Chinese', showName: false, name: '' });
	});

	it('shows a name when the workspace has one', () => {
		const zh = ws(1, 'zh', 'Novels');
		expect(workspaceDisplay([zh], zh)).toEqual({
			label: 'Chinese',
			showName: true,
			name: 'Novels'
		});
	});

	it('names every workspace of a language that has two or more', () => {
		const plain = ws(1, 'zh');
		const named = ws(2, 'zh', 'HSK');
		const ja = ws(3, 'ja');
		const list = [plain, named, ja];
		expect(workspaceDisplay(list, plain)).toEqual({
			label: 'Chinese',
			showName: true,
			name: 'Chinese'
		});
		expect(workspaceDisplay(list, named)).toEqual({ label: 'Chinese', showName: true, name: 'HSK' });
		expect(workspaceDisplay(list, ja).showName).toBe(false);
	});

	it('numbers unnamed duplicates in list order', () => {
		const a = ws(1, 'ja');
		const b = ws(2, 'ja');
		const c = ws(3, 'ja', 'News');
		const d = ws(4, 'ja');
		const list = [a, b, c, d];
		expect(workspaceDisplay(list, a).name).toBe('Japanese');
		expect(workspaceDisplay(list, b).name).toBe('Japanese 2');
		expect(workspaceDisplay(list, c).name).toBe('News');
		expect(workspaceDisplay(list, d).name).toBe('Japanese 3');
	});

	it('treats a whitespace-only name as unnamed', () => {
		const a = ws(1, 'es', '  ');
		expect(workspaceDisplay([a], a).showName).toBe(false);
	});
});

describe('languageOptions', () => {
	it('offers installed languages plus languages already used, sorted by label, never pack titles', () => {
		const options = languageOptions(
			[lang('es', 'Spanish–English demo dictionary'), lang('ja'), lang('zh')],
			[ws(1, 'zh'), ws(2, 'jp')]
		);
		expect(options).toEqual([
			{ code: 'zh', label: 'Chinese', hasDictionary: true },
			{ code: 'ja', label: 'Japanese', hasDictionary: true },
			{ code: 'jp', label: 'jp', hasDictionary: false },
			{ code: 'es', label: 'Spanish', hasDictionary: true }
		]);
	});

	it('deduplicates case-insensitively and works with nothing installed', () => {
		expect(languageOptions([], [ws(1, 'ZH'), ws(2, 'zh', 'x')])).toEqual([
			{ code: 'zh', label: 'Chinese', hasDictionary: false }
		]);
		expect(languageOptions([], [])).toEqual([]);
	});

	it('flags languages without installed dictionary data', () => {
		const options = languageOptions(
			[
				{ code: 'zh', name: 'zh', installed: true, kind: 'code' },
				{ code: 'pt', name: 'pt', installed: false, kind: 'data' }
			],
			[]
		);
		expect(options).toEqual([
			{ code: 'zh', label: 'Chinese', hasDictionary: true },
			{ code: 'pt', label: 'Portuguese', hasDictionary: false }
		]);
	});

	it('does not let a workspace entry hide an installed flag', () => {
		const options = languageOptions([lang('zh')], [ws(1, 'zh')]);
		expect(options).toEqual([{ code: 'zh', label: 'Chinese', hasDictionary: true }]);
	});
});
