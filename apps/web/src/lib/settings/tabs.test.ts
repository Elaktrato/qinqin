import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, parseSettingsTab, settingsTabHref, tabKeyTarget } from './tabs';

describe('parseSettingsTab', () => {
	it('defaults to workspaces', () => {
		expect(parseSettingsTab(null)).toBe('workspaces');
		expect(parseSettingsTab('')).toBe('workspaces');
	});

	it('accepts every tab id', () => {
		for (const tab of SETTINGS_TABS) expect(parseSettingsTab(tab)).toBe(tab);
	});

	it('falls back for unknown values', () => {
		expect(parseSettingsTab('Home')).toBe('workspaces');
		expect(parseSettingsTab('nope')).toBe('workspaces');
		expect(parseSettingsTab('constructor')).toBe('workspaces');
	});
});

describe('settingsTabHref', () => {
	it('keeps the default tab out of the URL', () => {
		expect(settingsTabHref('workspaces')).toBe('/settings');
		expect(settingsTabHref('home')).toBe('/settings?tab=home');
		expect(settingsTabHref('plugins')).toBe('/settings?tab=plugins');
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
