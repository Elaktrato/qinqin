// The Settings page's tabs and their `?tab=` deep links.

export const SETTINGS_TABS = ['workspaces', 'home', 'plugins', 'ai'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
	workspaces: 'Workspaces',
	home: 'Home',
	plugins: 'Plugins',
	ai: 'AI'
};

/** parseSettingsTab reads `?tab=`; a missing or unknown value is the first tab. */
export function parseSettingsTab(value: string | null): SettingsTab {
	return (SETTINGS_TABS as readonly string[]).includes(value ?? '')
		? (value as SettingsTab)
		: 'workspaces';
}

/** settingsTabHref is the URL of a tab; the default tab has no query. */
export function settingsTabHref(tab: SettingsTab): string {
	return tab === 'workspaces' ? '/settings' : `/settings?tab=${tab}`;
}

// One tablist key handler for Stats and Settings (lib/statsTabs.ts).
export { tabKeyTarget } from '../statsTabs';
