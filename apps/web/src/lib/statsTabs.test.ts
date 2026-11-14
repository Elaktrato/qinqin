import { describe, expect, it } from 'vitest';
import { activeStatsTab, statsTabs, tabKeyTarget } from './statsTabs';

describe('statsTabs', () => {
	it('offers Overview and Characters for Han languages', () => {
		expect(statsTabs('zh').map((tab) => tab.id)).toEqual(['overview', 'characters']);
		expect(statsTabs('ja').map((tab) => tab.id)).toEqual(['overview', 'characters']);
		expect(statsTabs('zh-TW').map((tab) => tab.id)).toEqual(['overview', 'characters']);
	});

	it('offers only Overview for other languages', () => {
		expect(statsTabs('es').map((tab) => tab.id)).toEqual(['overview']);
		expect(statsTabs('ko').map((tab) => tab.id)).toEqual(['overview']);
	});

	it('offers only Overview while no workspace is chosen', () => {
		expect(statsTabs(null).map((tab) => tab.id)).toEqual(['overview']);
	});

	it('links each tab to its own URL', () => {
		expect(statsTabs('zh')).toEqual([
			{ id: 'overview', label: 'Overview', href: '/stats' },
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
