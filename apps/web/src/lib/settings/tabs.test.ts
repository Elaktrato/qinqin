import { describe, expect, it } from 'vitest';
import {
	SETTINGS_TABS,
	SETTINGS_TAB_LABELS,
	parseSettingsTab,
	settingsTabHref,
	tabKeyTarget,
	visibleSettingsTabs
} from './tabs';

describe('parseSettingsTab', () => {
	it('defaults to workspaces', () => {
		expect(parseSettingsTab(null)).toBe('workspaces');
		expect(parseSettingsTab('')).toBe('workspaces');
	});

	it('knows the AI tab', () => {
		expect(parseSettingsTab('ai')).toBe('ai');
		expect(SETTINGS_TAB_LABELS.ai).toBe('AI');
	});

	it('accepts every tab id for an admin', () => {
		for (const tab of SETTINGS_TABS) expect(parseSettingsTab(tab, true)).toBe(tab);
	});

	it('hides the Data tab from everyone else', () => {
		expect(parseSettingsTab('data', false)).toBe('workspaces');
		expect(parseSettingsTab('data')).toBe('workspaces');
		expect(parseSettingsTab('data', true)).toBe('data');
		expect(SETTINGS_TAB_LABELS.data).toBe('Data');
	});

	it('falls back for unknown values', () => {
		expect(parseSettingsTab('Home')).toBe('workspaces');
		expect(parseSettingsTab('nope')).toBe('workspaces');
		expect(parseSettingsTab('constructor')).toBe('workspaces');
	});
});

describe('account tab', () => {
	it('is visible to everyone, between AI and Data', () => {
		expect(visibleSettingsTabs(false)).toEqual(['workspaces', 'home', 'plugins', 'ai', 'account']);
		expect(visibleSettingsTabs(true)).toEqual([
			'workspaces',
			'home',
			'plugins',
			'ai',
			'account',
			'data'
		]);
		expect(SETTINGS_TAB_LABELS.account).toBe('Account');
		expect(parseSettingsTab('account')).toBe('account');
		expect(settingsTabHref('account')).toBe('/settings?tab=account');
	});
});

describe('settingsTabHref', () => {
	it('keeps the default tab out of the URL', () => {
		expect(settingsTabHref('workspaces')).toBe('/settings');
		expect(settingsTabHref('home')).toBe('/settings?tab=home');
		expect(settingsTabHref('plugins')).toBe('/settings?tab=plugins');
		expect(settingsTabHref('ai')).toBe('/settings?tab=ai');
		expect(settingsTabHref('data')).toBe('/settings?tab=data');
	});
});

describe('tabKeyTarget', () => {
	it('moves with the arrows and wraps', () => {
		expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
		expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
		expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
		expect(tabKeyTarget('ArrowLeft', 1, 3)).toBe(0);
	});

	it('jumps with Home and End', () => {
		expect(tabKeyTarget('Home', 2, 3)).toBe(0);
		expect(tabKeyTarget('End', 0, 3)).toBe(2);
	});

	it('ignores other keys', () => {
		expect(tabKeyTarget('Enter', 1, 3)).toBeNull();
		expect(tabKeyTarget('ArrowDown', 1, 3)).toBeNull();
		expect(tabKeyTarget('a', 1, 3)).toBeNull();
	});
});

describe('visibleSettingsTabs', () => {
	it('shows the Data tab to admins only, last', () => {
		expect(visibleSettingsTabs(false)).not.toContain('data');
		const admin = visibleSettingsTabs(true);
		expect(admin[admin.length - 1]).toBe('data');
		expect(admin).toEqual(SETTINGS_TABS);
	});
});
