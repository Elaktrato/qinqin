// The workspace's known-ness index for the level check (#82): the shared
// predicate's index (lib/studycore/known.ts) over the live cards, their derived
// schedules and the marks, read fresh. The same three lines as the lookup
// history's; the predicate itself is never forked.

import type { Session } from '$lib/context/session.svelte';
import { scheduleIndex } from '$lib/features/flashcards/decks/deckStats';
import { contextForData } from '$lib/studycore/currentContext';
import { loadStudyHistory } from '$lib/studycore/data';
import { knownIndex, type KnownIndex } from '$lib/studycore/known';
import { activeWeights } from '$lib/studycore/readModel';

export async function loadKnownIndex(session: Session, workspaceId: number): Promise<KnownIndex> {
	const data = await loadStudyHistory(session.study, workspaceId, { force: true });
	const schedules = scheduleIndex(data.cards, data.reviews, activeWeights(data), contextForData(session.zone, data, workspaceId).clock);
	return knownIndex(data.cards, (id) => schedules.get(id) ?? null, data.known);
}
