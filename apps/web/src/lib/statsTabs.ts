// The Stats page's views and their URLs. Pure, so the language rule and
// the keyboard model of the tablist are tested without rendering.

import { usesHan } from './languages';
import { normalizePath } from './routeAccess';

export type StatsTabId = 'overview' | 'characters';

export interface StatsTab {
	id: StatsTabId;
	label: string;
	href: string;
}

const OVERVIEW: StatsTab = { id: 'overview', label: 'Overview', href: '/stats' };
const CHARACTERS: StatsTab = { id: 'characters', label: 'Characters', href: '/stats/characters' };

/**
 * statsTabs lists the views for the workspace language: Overview always,
 * Characters (the character map) only for languages written with Han
 * characters. With no workspace chosen there is no map to show.
 */
export function statsTabs(language: string | null): StatsTab[] {
	return language !== null && usesHan(language) ? [OVERVIEW, CHARACTERS] : [OVERVIEW];
}

/** activeStatsTab is the view a pathname shows, or null outside Stats. */
export function activeStatsTab(path: string): StatsTabId | null {
	const normalized = normalizePath(path);
	if (normalized === OVERVIEW.href) return 'overview';
	if (normalized === CHARACTERS.href) return 'characters';
	return null;
}

/**
 * tabKeyTarget is the index of the tab a key moves to in a horizontal
 * tablist (ArrowLeft/ArrowRight wrap round, Home and End jump), or null
 * when the key is not a tablist key. A current index of -1 (no tab
 * selected) starts from the edges.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowRight':
			return index < 0 ? 0 : (index + 1) % count;
		case 'ArrowLeft':
			return index < 0 ? count - 1 : (index - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
