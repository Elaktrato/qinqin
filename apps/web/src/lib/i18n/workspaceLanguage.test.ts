import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/settings/interface-language.json';
import {
	WORKSPACE_LANGUAGE_KEY,
	applyingSetting,
	commonSetting,
	resolveWorkspaceLanguage,
	workspaceLanguagePatch,
	workspaceSetting
} from './workspaceLanguage';

type Settings = Record<string, unknown> | null;

// docs/contracts/settings/interface-language.json (#297): the workspace's own interface language, the setting that
// applies (workspace, else account, else the browser) and the reminder rule the server follows.
describe('docs/contracts/settings/interface-language.json', () => {
	it('names the key', () => {
		expect(fixture.rule).toBe('settings/interface-language');
		expect(WORKSPACE_LANGUAGE_KEY).toBe(fixture.key);
	});

	for (const c of fixture.parse) {
		it(`parse: ${c.name}`, () => {
			expect(workspaceSetting(c.settings as Settings)).toBe(c.expect);
		});
	}

	for (const c of fixture.resolve) {
		it(`resolve: ${c.name}`, () => {
			const workspace = c.workspace === null ? null : { settings: c.workspace as Settings };
			expect(resolveWorkspaceLanguage(workspace, c.account, c.browser, c.supported)).toBe(c.expect);
		});
	}

	for (const c of fixture.reminder) {
		it(`reminder: ${c.name}`, () => {
			expect(commonSetting(c.account, c.workspaces.map((w) => workspaceSetting(w as Settings)))).toBe(c.expect);
		});
	}
});

describe('applyingSetting', () => {
	it('is the workspace setting, else the account setting', () => {
		expect(applyingSetting('de', 'ja')).toBe('de');
		expect(applyingSetting('', 'ja')).toBe('ja');
		expect(applyingSetting('', '')).toBe('');
	});
});

describe('workspaceLanguagePatch', () => {
	it('stores a language and clears the key for "use my account setting" (null in a merge patch)', () => {
		expect(workspaceLanguagePatch('de')).toEqual({ interfaceLanguage: 'de' });
		expect(workspaceLanguagePatch('')).toEqual({ interfaceLanguage: null });
	});

	it('refuses a value that is not a language tag', () => {
		expect(() => workspaceLanguagePatch('German')).toThrow();
	});
});
