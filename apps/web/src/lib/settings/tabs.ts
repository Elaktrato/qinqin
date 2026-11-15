// The Settings page's tabs and their `?tab=` deep links.

export const SETTINGS_TABS = [
	'workspaces',
	'home',
	'study',
	'plugins',
	'ai',
	'account',
	'data',
	'admin'
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
	workspaces: 'Workspaces',
	home: 'Home',
	study: 'Study',
	plugins: 'Plugins',
	ai: 'AI',
	account: 'Account',
	data: 'Data',
	admin: 'Admin'
};

const ADMIN_ONLY: readonly SettingsTab[] = ['data', 'admin'];

/** visibleSettingsTabs: the Data tab (packs) and the Admin tab (users, invites, security) are for admins only. */
export function visibleSettingsTabs(admin: boolean): SettingsTab[] {
	return SETTINGS_TABS.filter((tab) => admin || !ADMIN_ONLY.includes(tab));
}

/** The sections of the Admin tab (`?tab=admin&section=`). Email arrives with the mail settings. */
export const ADMIN_SECTIONS = ['users', 'invites', 'security'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
	users: 'Users',
	invites: 'Invites',
	security: 'Security'
};

/** parseAdminSection reads `?section=`; anything unknown is Users. */
export function parseAdminSection(value: string | null): AdminSection {
	return (ADMIN_SECTIONS as readonly string[]).includes(value ?? '') ? (value as AdminSection) : 'users';
}

/** adminSectionHref is the URL of an Admin section. */
export function adminSectionHref(section: AdminSection): string {
	return `/settings?tab=admin&section=${section}`;
}

/**
 * parseSettingsTab reads `?tab=`; a missing or unknown value, or a tab
 * the viewer may not see, is the first tab.
 */
export function parseSettingsTab(value: string | null, admin = false): SettingsTab {
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
