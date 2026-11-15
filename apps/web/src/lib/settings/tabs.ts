// The Settings page's tabs and their `?tab=` deep links.

export const SETTINGS_TABS = [
	'workspaces',
	'home',
	'study',
	'plugins',
	'ai',
	'account',
	'data'
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
	workspaces: 'Workspaces',
	home: 'Home',
	study: 'Study',
	plugins: 'Plugins',
	ai: 'AI',
	account: 'Account',
	data: 'Data'
};

/** visibleSettingsTabs: the Data tab (pack management) is for admins only. */
export function visibleSettingsTabs(admin: boolean): SettingsTab[] {
	return SETTINGS_TABS.filter((tab) => tab !== 'data' || admin);
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
