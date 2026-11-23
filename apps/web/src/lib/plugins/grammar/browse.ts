// Grouping of installed grammar packs into browse sections.

import type { Level, LessonSummary, PackInfo, Progress } from './types';
import { progressKey } from './progress';

export interface BrowseLesson extends LessonSummary {
	progress: Progress | null;
}

export interface BrowseLevel {
	id: string;
	name: string;
	badges: string[];
	lessons: BrowseLesson[];
}

export interface Section {
	packId: string;
	packName: string;
	credits: { license: string; attribution: string; version: string };
	levels: BrowseLevel[];
}

interface SchemeRef {
	packId?: string;
	levels: { name: string }[];
}

function badgesFor(level: Level, schemes: SchemeRef[]): string[] {
	const badges: string[] = [];
	for (const ref of level.schemeLevels) {
		const found = schemes.some(
			(s) => s.packId === ref.scheme && s.levels.some((l) => l.name === ref.level)
		);
		if (found) badges.push(`≈ ${ref.level}`);
	}
	return badges;
}

/**
 * browseSections shows every installed pack level by level (packs are
 * managed in Settings → Data; a pack has no plugin state, #198). Progress rows of
 * lessons that no longer exist are ignored; levels without lessons are
 * omitted; a scheme badge appears only when that scheme's level is installed.
 */
export function browseSections(
	packs: PackInfo[],
	schemes: SchemeRef[],
	progress: Map<string, Progress>
): Section[] {
	const sections: Section[] = [];
	for (const pack of packs) {
		const lessons = pack.lessons ?? [];
		const levels: BrowseLevel[] = [];
		for (const level of pack.levels) {
			const inLevel = lessons
				.filter((l) => l.level === level.id)
				.map((l) => ({
					...l,
					progress: progress.get(progressKey(pack.packId, l.id)) ?? null
				}));
			if (inLevel.length === 0) continue;
			levels.push({
				id: level.id,
				name: level.name,
				badges: badgesFor(level, schemes),
				lessons: inLevel
			});
		}
		sections.push({
			packId: pack.packId,
			packName: pack.name,
			credits: { license: pack.license, attribution: pack.attribution, version: pack.version },
			levels
		});
	}
	return sections;
}
