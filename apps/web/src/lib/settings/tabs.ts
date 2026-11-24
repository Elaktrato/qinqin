// The Settings page's tabs and their `?tab=` deep links.

import { t } from '$lib/i18n';

export const SETTINGS_TABS = [
	'workspaces',
	'layout',
	'appearance',
	'study',
	'features',
	'ai',
	'account',
	'data',
	'admin'
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Readonly<Record<SettingsTab, string>> = {
	get workspaces() {
		return t('settings.tabs.workspaces');
	},
	get layout() {
		return t('settings.tabs.layout');
	},
	get appearance() {
		return t('settings.tabs.appearance');
	},
	get study() {
		return t('settings.tabs.study');
	},
	get features() {
		return t('settings.tabs.features');
	},
	get ai() {
		return t('settings.tabs.ai');
	},
	get account() {
		return t('settings.tabs.account');
	},
	get data() {
		return t('settings.tabs.data');
	},
	get admin() {
		return t('settings.tabs.admin');
	}
};

const ADMIN_ONLY: readonly SettingsTab[] = ['data', 'admin'];

/** visibleSettingsTabs: the Data tab (packs) and the Admin tab (users, invites, security) are for admins only. */
export function visibleSettingsTabs(admin: boolean): SettingsTab[] {
	return SETTINGS_TABS.filter((tab) => admin || !ADMIN_ONLY.includes(tab));
}

/** The sections of the Admin tab (`?tab=admin&section=`). Email arrives with the mail settings. */
export const ADMIN_SECTIONS = ['users', 'invites', 'email', 'security', 'backup'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_SECTION_LABELS: Readonly<Record<AdminSection, string>> = {
	get users() {
		return t('settings.admin.users');
	},
	get invites() {
		return t('settings.admin.invites');
	},
	get email() {
		return t('settings.admin.email');
	},
	get security() {
		return t('settings.admin.security');
	},
	get backup() {
		return t('settings.admin.backup');
	}
};

/** parseAdminSection reads `?section=`; anything unknown is Users. */
export function parseAdminSection(value: string | null): AdminSection {
	return (ADMIN_SECTIONS as readonly string[]).includes(value ?? '') ? (value as AdminSection) : 'users';
}

/**
 * settingsTitleParts is the document title of a Settings view, most
 * specific first: "Users · Admin · Settings", "AI · Settings" (pageTitle
 * adds the app name). `section` is the raw `?section=` value.
 */
export function settingsTitleParts(tab: SettingsTab, section: string | null): string[] {
	if (tab === 'admin') return [ADMIN_SECTION_LABELS[parseAdminSection(section)], SETTINGS_TAB_LABELS.admin, t('settings.title')];
	return [SETTINGS_TAB_LABELS[tab], t('settings.title')];
}

/** adminSectionHref is the URL of an Admin section. */
export function adminSectionHref(section: AdminSection): string {
	return `/settings?tab=admin&section=${section}`;
}

/**
 * Old `?tab=` values and the tab they are now (#188: Home became Layout,
 * holding the home widgets and the phone navigation). The page replaces
 * the URL, so old links and bookmarks keep working.
 */
export const RENAMED_TABS: Readonly<Record<string, SettingsTab>> = { home: 'layout' };

/**
 * parseSettingsTab reads `?tab=`; a missing or unknown value, or a tab
 * the viewer may not see, is the first tab. A renamed tab's old value is
 * the new tab.
 */
export function parseSettingsTab(value: string | null, admin = false): SettingsTab {
	if (value !== null && Object.hasOwn(RENAMED_TABS, value)) value = RENAMED_TABS[value];
	return (visibleSettingsTabs(admin) as readonly string[]).includes(value ?? '')
		? (value as SettingsTab)
		: 'workspaces';
}

/** settingsTabHref is the URL of a tab; the default tab has no query. */
export function settingsTabHref(tab: SettingsTab): string {
	return tab === 'workspaces' ? '/settings' : `/settings?tab=${tab}`;
}

// One tablist key handler for Stats and Settings (lib/statsTabs.ts).
export { tabKeyTarget } from '../statsTabs';
