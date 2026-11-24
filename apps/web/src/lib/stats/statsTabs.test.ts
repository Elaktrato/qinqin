import { describe, expect, it } from 'vitest';
import { activeStatsTab, statsPanelLabel, statsTabs, tabKeyTarget } from './statsTabs';

describe('statsTabs', () => {
	it('offers Overview, Week and Characters for Han languages', () => {
		expect(statsTabs('zh').map((tab) => tab.id)).toEqual(['overview', 'week', 'characters']);
		expect(statsTabs('ja').map((tab) => tab.id)).toEqual(['overview', 'week', 'characters']);
		expect(statsTabs('zh-TW').map((tab) => tab.id)).toEqual(['overview', 'week', 'characters']);
	});

	it('offers Overview and Week for other languages', () => {
		expect(statsTabs('es').map((tab) => tab.id)).toEqual(['overview', 'week']);
		expect(statsTabs('ko').map((tab) => tab.id)).toEqual(['overview', 'week']);
	});

	it('offers only Overview while no workspace is chosen', () => {
		expect(statsTabs(null).map((tab) => tab.id)).toEqual(['overview']);
	});

	it('links each tab to its own URL', () => {
		expect(statsTabs('zh')).toEqual([
			{ id: 'overview', label: 'Overview', href: '/stats' },
			{ id: 'week', label: 'Week', href: '/stats/week' },
			{ id: 'characters', label: 'Characters', href: '/stats/characters' }
		]);
	});
});

describe('activeStatsTab', () => {
	it('maps the Stats URLs to their tab', () => {
		expect(activeStatsTab('/stats')).toBe('overview');
		expect(activeStatsTab('/stats/')).toBe('overview');
		expect(activeStatsTab('/stats/characters')).toBe('characters');
		expect(activeStatsTab('/stats/characters/')).toBe('characters');
	});

	it('is null anywhere else', () => {
		expect(activeStatsTab('/stats/other')).toBeNull();
		expect(activeStatsTab('/statsx')).toBeNull();
		expect(activeStatsTab('/study/map')).toBeNull();
		expect(activeStatsTab('/')).toBeNull();
	});
});

describe('tabKeyTarget', () => {
	it('moves right and left, wrapping round', () => {
		expect(tabKeyTarget('ArrowRight', 0, 2)).toBe(1);
		expect(tabKeyTarget('ArrowRight', 1, 2)).toBe(0);
		expect(tabKeyTarget('ArrowLeft', 1, 2)).toBe(0);
		expect(tabKeyTarget('ArrowLeft', 0, 2)).toBe(1);
	});

	it('jumps to the first and last tab', () => {
		expect(tabKeyTarget('Home', 2, 3)).toBe(0);
		expect(tabKeyTarget('End', 0, 3)).toBe(2);
	});

	it('stays on a single tab', () => {
		expect(tabKeyTarget('ArrowRight', 0, 1)).toBe(0);
		expect(tabKeyTarget('End', 0, 1)).toBe(0);
	});

	it('ignores other keys and an empty list', () => {
		expect(tabKeyTarget('ArrowDown', 0, 2)).toBeNull();
		expect(tabKeyTarget('Enter', 0, 2)).toBeNull();
		expect(tabKeyTarget('a', 0, 2)).toBeNull();
		expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
	});

	it('starts from the edges when no tab is selected', () => {
		expect(tabKeyTarget('ArrowRight', -1, 2)).toBe(0);
		expect(tabKeyTarget('ArrowLeft', -1, 2)).toBe(1);
	});
});

describe('the Week tab', () => {
	it('sits between Overview and Characters whenever a workspace is chosen', () => {
		expect(statsTabs('zh').map((tab) => tab.id)).toEqual(['overview', 'week', 'characters']);
		expect(statsTabs('es').map((tab) => tab.id)).toEqual(['overview', 'week']);
		expect(statsTabs(null).map((tab) => tab.id)).toEqual(['overview']);
		expect(statsTabs('es')[1]).toEqual({ id: 'week', label: 'Week', href: '/stats/week' });
	});

	it('is active on /stats/week, with or without a query', () => {
		expect(activeStatsTab('/stats/week')).toBe('week');
		expect(activeStatsTab('/stats/week/')).toBe('week');
	});

	it('names the panel', () => {
		expect(statsPanelLabel('week')).toBe('Week');
		expect(statsPanelLabel('characters')).toBe('Characters');
		expect(statsPanelLabel('overview')).toBe('Overview');
		expect(statsPanelLabel(null)).toBe('Overview');
	});
});
