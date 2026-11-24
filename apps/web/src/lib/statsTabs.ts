// The Stats page's views and their URLs. Pure, so the language rule and
// the keyboard model of the tablist are tested without rendering.

import { hasCharacterMap } from './languageProfiles';
import { t, type MessageKey } from './i18n';
import { normalizePath } from './routeAccess';

export type StatsTabId = 'overview' | 'week' | 'characters';

export interface StatsTab {
	id: StatsTabId;
	label: string;
	href: string;
}

function tab(id: StatsTabId, label: MessageKey, href: string): StatsTab {
	return {
		id,
		get label() {
			return t(label);
		},
		href
	};
}

const OVERVIEW: StatsTab = tab('overview', 'stats.tabs.overview', '/stats');
const WEEK: StatsTab = tab('week', 'stats.tabs.week', '/stats/week');
const CHARACTERS: StatsTab = tab('characters', 'stats.tabs.characters', '/stats/characters');

/**
 * statsTabs lists the views for the workspace language: Overview always,
 * Week (the weekly summary) with a workspace, Characters (the character
 * map) only for languages whose profile offers it (practiceModes). With no workspace
 * chosen there is no week or map to show.
 */
export function statsTabs(language: string | null): StatsTab[] {
	if (language === null) return [OVERVIEW];
	return hasCharacterMap(language) ? [OVERVIEW, WEEK, CHARACTERS] : [OVERVIEW, WEEK];
}

/** activeStatsTab is the view a pathname shows, or null outside Stats. */
export function activeStatsTab(path: string): StatsTabId | null {
	const normalized = normalizePath(path);
	if (normalized === OVERVIEW.href) return 'overview';
	if (normalized === WEEK.href) return 'week';
	if (normalized === CHARACTERS.href) return 'characters';
	return null;
}

/** statsPanelLabel names the panel (and the page title) of a view. */
export function statsPanelLabel(id: StatsTabId | null): string {
	if (id === 'week') return WEEK.label;
	if (id === 'characters') return CHARACTERS.label;
	return OVERVIEW.label;
}

/**
 * tabKeyTarget is the index of the tab a key moves to in a horizontal
 * tablist (ArrowLeft/ArrowRight wrap round, Home and End jump), or null
 * when the key is not a tablist key. A current index of -1 (no tab
 * selected) starts from the edges. The settings tabs re-export it.
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
