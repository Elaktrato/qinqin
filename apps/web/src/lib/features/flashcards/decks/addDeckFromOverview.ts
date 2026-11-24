// One-click "Add" in the decks overview: the same idempotent copy plan as the
// system/starter detail pages (addToDeck.ts), without the target picker. The
// deck gets its usual owned id and name; adding again joins only what is new.

import type { StudyState } from '$lib/study/data';
import type { NewOrder } from '$lib/study/newOrder';
import { loadRawStudyData } from '$lib/study/data';
import { pushStudy } from '$lib/study/commands/write';
import type { Deck } from '$lib/study/types';
import { addPlanRows, planAddToDeck, type AddItem, type AddPlan } from './addToDeck';

export interface OverviewAddInput {
	workspaceId: number;
	items: readonly AddItem[];
	target: { id: string; name: string; source?: Deck['source'] };
	/** Starter decks: the words the learner already knows are left out. */
	exclude?: ReadonlySet<number>;
	/** Starter decks: the copy is ordered most frequent first. */
	settings?: { newOrder: NewOrder };
}

/** addDeckFromOverview plans from the stored rows now and pushes one batch. */
export async function addDeckFromOverview(study: StudyState, input: OverviewAddInput): Promise<AddPlan> {
	const raw = await loadRawStudyData(study, input.workspaceId);
	const plan = planAddToDeck({
		items: input.items,
		target: input.target,
		existingDeck: raw.decks.find((deck) => deck.id === input.target.id) ?? null,
		rawCards: raw.cards,
		unreadable: raw.unreadable,
		now: new Date(),
		exclude: input.exclude,
		settings:
			input.settings === undefined
				? undefined
				: {
						newOrder: input.settings.newOrder,
						exists: raw.deckSettings?.[input.target.id] !== undefined
					}
	});
	const rows = addPlanRows(plan, raw);
	if (rows.length > 0) await pushStudy(study, input.workspaceId, rows);
	return plan;
}
