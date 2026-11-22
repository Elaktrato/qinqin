import { describe, expect, it } from 'vitest';
import {
	ADMIN_SECTIONS,
	adminSectionHref,
	parseAdminSection,
	SETTINGS_TABS,
	SETTINGS_TAB_LABELS,
	parseSettingsTab,
	settingsTabHref,
	settingsTitleParts,
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

describe('the Study tab', () => {
	it('is visible to every user and parsed from ?tab=study', () => {
		expect(visibleSettingsTabs(false)).toContain('study');
		expect(visibleSettingsTabs(true)).toContain('study');
		expect(parseSettingsTab('study')).toBe('study');
		expect(SETTINGS_TAB_LABELS.study).toBe('Study');
		expect(settingsTabHref('study')).toBe('/settings?tab=study');
	});
});

describe('features tab', () => {
	it('is visible to everyone, before Plugins', () => {
		expect(SETTINGS_TAB_LABELS.features).toBe('Features');
		expect(parseSettingsTab('features')).toBe('features');
		expect(settingsTabHref('features')).toBe('/settings?tab=features');
		expect(settingsTitleParts('features', null)).toEqual(['Features', 'Settings']);
	});
});

describe('account tab', () => {
	it('is visible to everyone, between AI and Data', () => {
		expect(visibleSettingsTabs(false)).toEqual(['workspaces', 'layout', 'appearance', 'study', 'features', 'plugins', 'ai', 'account']);
		expect(visibleSettingsTabs(true)).toEqual([
			'workspaces',
			'layout',
			'appearance',
			'study',
			'features',
			'plugins',
			'ai',
			'account',
			'data',
			'admin'
		]);
		expect(SETTINGS_TAB_LABELS.account).toBe('Account');
		expect(parseSettingsTab('account')).toBe('account');
		expect(settingsTabHref('account')).toBe('/settings?tab=account');
	});
});

describe('settingsTabHref', () => {
	it('keeps the default tab out of the URL', () => {
		expect(settingsTabHref('workspaces')).toBe('/settings');
		expect(settingsTabHref('layout')).toBe('/settings?tab=layout');
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
	it('shows the Data and Admin tabs to admins only, Admin last', () => {
		expect(visibleSettingsTabs(false)).not.toContain('data');
		expect(visibleSettingsTabs(false)).not.toContain('admin');
		const admin = visibleSettingsTabs(true);
		expect(admin.slice(-2)).toEqual(['data', 'admin']);
		expect(admin).toEqual(SETTINGS_TABS);
	});
});

describe('the Admin tab', () => {
	it('is parsed for admins only and labelled', () => {
		expect(parseSettingsTab('admin', true)).toBe('admin');
		expect(parseSettingsTab('admin', false)).toBe('workspaces');
		expect(SETTINGS_TAB_LABELS.admin).toBe('Admin');
	});
	it('has the sections Users, Invites, Email, Security with Users as the default', () => {
		expect([...ADMIN_SECTIONS]).toEqual(['users', 'invites', 'email', 'security', 'backup']);
		expect(parseAdminSection(null)).toBe('users');
		expect(parseAdminSection('invites')).toBe('invites');
		expect(parseAdminSection('email')).toBe('email');
		expect(parseAdminSection('nope')).toBe('users');
		expect(adminSectionHref('security')).toBe('/settings?tab=admin&section=security');
	});
});

describe('settingsTitleParts', () => {
	it('names the tab, then Settings', () => {
		expect(settingsTitleParts('workspaces', null)).toEqual(['Workspaces', 'Settings']);
		expect(settingsTitleParts('ai', 'users')).toEqual(['AI', 'Settings']);
	});

	it('puts the Admin section first', () => {
		expect(settingsTitleParts('admin', 'users')).toEqual(['Users', 'Admin', 'Settings']);
		expect(settingsTitleParts('admin', 'backup')).toEqual(['Backup', 'Admin', 'Settings']);
	});

	it('reads a missing or unknown section as Users, like the Admin tab', () => {
		expect(settingsTitleParts('admin', null)).toEqual(['Users', 'Admin', 'Settings']);
		expect(settingsTitleParts('admin', 'nope')).toEqual(['Users', 'Admin', 'Settings']);
	});
});

describe('the Appearance tab', () => {
	it('is personal (every user), right after Home', () => {
		expect(visibleSettingsTabs(false)).toContain('appearance');
		expect(SETTINGS_TABS.indexOf('appearance')).toBe(SETTINGS_TABS.indexOf('layout') + 1);
		expect(parseSettingsTab('appearance')).toBe('appearance');
		expect(SETTINGS_TAB_LABELS.appearance).toBe('Appearance');
		expect(settingsTabHref('appearance')).toBe('/settings?tab=appearance');
		expect(settingsTitleParts('appearance', null)).toEqual(['Appearance', 'Settings']);
	});
});
