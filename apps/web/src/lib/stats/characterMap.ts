// The character map's numbers outside the map page: the same mastery
// pass the map runs (every glyph and variant scored once, a cell taking
// the best of its forms), reduced to the totals a summary tile shows.
// The map page itself keeps its own loading, because it also needs the
// level schemes and paints progressively.

import type { Session } from '$lib/context/session.svelte';
import { fetchCharacters, type CharacterList } from '$lib/api/characters';
import type { CharRow } from '$lib/api/types';
import { cellStates, masteryGlyphs, sectionStats, type SectionStats } from '$lib/study/charGroups';
import { fillMissingWritten } from '$lib/study/entriesCache';
import { masteryForChars } from '$lib/study/mastery';
import type { StudyClock } from '$lib/study/studyClock';
import { contextForData } from '$lib/study/currentContext';
import { loadStudyHistory } from '$lib/study/data';
import { activeWeights } from '$lib/study/readModel';
import type { ReviewEvent, StudyCard } from '$lib/study/types';

/** characterSummary counts the characters per mastery stage and those learned. */
export function characterSummary(
	chars: readonly CharRow[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[],
	clock: StudyClock
): SectionStats {
	const mastery = masteryForChars(masteryGlyphs(chars), cards, reviews, now, w, clock);
	return sectionStats(cellStates(chars, mastery));
}

export interface CharacterMapData {
	list: CharacterList;
	cards: StudyCard[];
	reviews: ReviewEvent[];
	/** The workspace's active FSRS weights. */
	w: readonly number[];
	/** The workspace's study clock (vacation days removed). */
	clock: StudyClock;
}

/**
 * loadCharacterMapData reads what the summary needs: the language's
 * character universe (fetchCharacters keeps it in memory for the
 * session, so a second home visit does not download ~13k rows again)
 * and the workspace's merged study data (the widgets' shared cache;
 * `force` reads it again).
 */
export async function loadCharacterMapData(
	session: Session,
	workspaceId: number,
	language: string,
	opts?: { force?: boolean }
): Promise<CharacterMapData> {
	const [list, data] = await Promise.all([
		fetchCharacters(session.caches.characters, language),
		loadStudyHistory(session.study, workspaceId, opts)
	]);
	return {
		list,
		cards: data.cards,
		reviews: data.reviews,
		w: activeWeights(data),
		clock: contextForData(session.zone, data, workspaceId).clock
	};
}

/**
 * withLegacyWritten fills the written snapshot of cards added before
 * cards carried one (entry lookups, cached per entry for the session),
 * as the map does. Cards that stay unresolved are counted.
 */
export async function withLegacyWritten(
	session: Session,
	cards: readonly StudyCard[]
): Promise<{ cards: StudyCard[]; unresolved: number }> {
	const filled = await fillMissingWritten(session.caches.written, cards);
	return { cards: filled, unresolved: filled.filter((card) => card.written === undefined).length };
}
