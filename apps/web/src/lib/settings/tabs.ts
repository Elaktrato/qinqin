// The Settings page's tabs and their `?tab=` deep links.

export const SETTINGS_TABS = ['workspaces', 'home', 'plugins'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
	workspaces: 'Workspaces',
	home: 'Home',
	plugins: 'Plugins'
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

/**
 * tabKeyTarget is the tab index a key moves to in a horizontal tablist
 * (Left/Right wrap, Home/End jump), or null for any other key.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
	if (key === 'ArrowRight') return (index + 1) % count;
	if (key === 'ArrowLeft') return (index - 1 + count) % count;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	return null;
}
