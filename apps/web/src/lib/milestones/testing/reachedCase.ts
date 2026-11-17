// Test helper: decodes one case of docs/contracts/milestones/reached.json into
// the inputs of reachedFromLog / reachedFromReplay. Not used by the app.

import type { CharRow } from '$lib/api/types';
import type { StudyEvent } from '$lib/events';
import { usesHan } from '$lib/languages';
import { GENERAL_DECK_ID } from '$lib/study/store';
import type { ReviewEvent, StudyCard } from '$lib/study/types';
import type { Run } from '$lib/study/vacation';
import { studyDay, type StudyDay, type ZoneChange } from '$lib/time/studyDay';
import { givenTimelines, type Timelines } from '$lib/weekly/replay';
import { FAMILIES, enabledFamilies, type MilestoneFamily } from '../catalogue';
import type { Reached } from '../reached';

/** A level of the fixture (replayReached's LevelInput). */
interface LevelInput {
	packId: string;
	level: string;
	unit: 'word' | 'character';
	entryIds: readonly number[];
	cells?: readonly string[][];
}

export interface ReachedCase {
	name: string;
	note: string;
	history: ZoneChange[];
	now: string;
	language: string;
	vacation: Run[];
	enabled: { flashcards: boolean; reader: boolean; journal: boolean };
	reviews: { id: string; ts: string; payload: unknown }[];
	events: { id: string; ts: string; type: string; payload: unknown }[];
	cards: StudyCard[];
	decks: string[];
	timelines: Record<string, { ts: string; state: number; stability: number }[]>;
	chars: CharRow[] | null;
	levels: (LevelInput & { deckId: string })[];
	expect: { id: string; reachedAt: string; reachedDay: string }[];
}

export interface DecodedCase {
	day: StudyDay;
	now: number;
	families: Set<MilestoneFamily>;
	reviews: ReviewEvent[];
	events: StudyEvent[];
	cards: StudyCard[];
	deckIds: Set<string>;
	vacation: Run[];
	timelines: Timelines;
	chars: CharRow[] | null;
	levels: LevelInput[];
}

export function decodeCase(c: ReachedCase): DecodedCase {
	const families = enabledFamilies({ ...c.enabled, han: usesHan(c.language) });
	return {
		day: studyDay(c.history),
		now: Date.parse(c.now),
		families,
		reviews: c.reviews.map((r) => ({ ...r, workspaceId: 1, device: 'web', type: 'review' }) as ReviewEvent),
		events: c.events.map((e) => ({ ...e, workspaceId: 1, device: 'web' })),
		cards: c.cards,
		deckIds: new Set([GENERAL_DECK_ID, ...c.decks]),
		vacation: c.vacation,
		timelines: givenTimelines(c.timelines),
		chars: c.chars,
		levels: c.levels.map(({ packId, level, unit, entryIds, cells }) => ({
			packId,
			level,
			unit,
			entryIds: entryIds ?? [],
			...(cells === undefined ? {} : { cells })
		}))
	};
}

const SOURCE = new Map(FAMILIES.map((f) => [f.family, f.source]));

/** The expected ids of one source ('log' or 'replay'). */
export function expectedOf(c: ReachedCase, source: 'log' | 'replay'): ReachedCase['expect'] {
	return c.expect.filter((e) => SOURCE.get(e.id.slice(0, e.id.indexOf(':')) as MilestoneFamily) === source);
}

/** The fixture form of a result: RFC 3339 without milliseconds. */
export function asFixture(list: readonly Reached[]): ReachedCase['expect'] {
	return list.map((r) => ({
		id: r.id,
		reachedAt: new Date(r.at).toISOString().replace('.000Z', 'Z'),
		reachedDay: r.day
	}));
}
