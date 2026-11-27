// The interface language of a workspace (#297; docs/contracts/settings/interface-language.json). A workspace may
// choose its own interface language (the workspace-settings key `interfaceLanguage`); without one it uses the
// account's (`me.interfaceLanguage`, #73), which without one follows the browser. Pure: the mirror and the reload
// that apply it are in ./interfaceLanguage.ts.
import { SUPPORTED_LANGUAGES, isLanguageSetting, negotiate } from './negotiate';

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const WORKSPACE_LANGUAGE_KEY = 'interfaceLanguage';

/** The workspace's own setting: a well-formed, non-empty tag, or '' ("use my account setting"). */
export function workspaceSetting(settings: Readonly<Record<string, unknown>> | null | undefined): string {
	const value = settings?.[WORKSPACE_LANGUAGE_KEY];
	return typeof value === 'string' && value !== '' && isLanguageSetting(value) ? value : '';
}

/** The setting that applies in a workspace: its own, else the account's ('' = follow the browser). */
export function applyingSetting(workspace: string, account: string): string {
	return workspace !== '' ? workspace : account;
}

/**
 * The interface language of a page load: in a workspace the setting that applies, outside one (`null`) the
 * account's; that setting, else the browser's languages, negotiated against the catalogues that exist.
 */
export function resolveWorkspaceLanguage(
	workspace: { settings?: Readonly<Record<string, unknown>> | null } | null,
	account: string,
	browser: readonly string[],
	supported: readonly string[] = SUPPORTED_LANGUAGES
): string {
	const setting = workspace === null ? account : applyingSetting(workspaceSetting(workspace.settings), account);
	return negotiate(setting ? [setting] : [...browser], supported);
}

/**
 * The setting of a text about several workspaces (the server's reminder mail): the applying setting they share,
 * else the account's, also when there are none. `workspaces` holds each one's own setting.
 */
export function commonSetting(account: string, workspaces: readonly string[]): string {
	if (workspaces.length === 0) return account;
	const common = applyingSetting(workspaces[0], account);
	return workspaces.every((w) => applyingSetting(w, account) === common) ? common : account;
}

/** The merge patch that stores `setting` ('' = "use my account setting": the key is removed). */
export function workspaceLanguagePatch(setting: string): Record<string, string | null> {
	if (!isLanguageSetting(setting)) throw new Error(`not a language tag: ${setting}`);
	return { [WORKSPACE_LANGUAGE_KEY]: setting === '' ? null : setting };
}
