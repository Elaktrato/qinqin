// The Words panel's bulk actions (#68): add unknown words to a deck through
// the decks view's idempotent add-to-deck plan, and mark words known (with
// an undo that tombstones exactly what it wrote). Pure apart from the
// injected reads and writes; always the book's workspace.
import type { EntryBase } from '$lib/api/types';
import type { StudySnapshot, StudyWrite } from '$lib/study/store';
import type { Deck, StudyCard } from '$lib/study/types';
import { addPlanRows, planAddToDeck } from '../flashcards/decks/addToDeck';

export interface AddWordsResult {
	created: number;
	joined: number;
	skipped: number;
	/** Entries the server no longer has (no base): left out. */
	missing: number;
}

export async function addWords(o: {
	workspaceId: number;
	entryIds: readonly number[];
	target: { id: string; name: string };
	now: Date;
	/** loadEntryBases (POST /api/entries/bases in chunks of 500). */
	bases: (ids: readonly number[]) => Promise<ReadonlyMap<number, EntryBase>>;
	/** loadRawStudyData of the workspace. */
	raw: () => Promise<{ decks: Deck[]; cards: StudyCard[] } & Partial<StudySnapshot>>;
	/** pushStudy. */
	push: (workspaceId: number, writes: readonly StudyWrite[]) => Promise<void>;
}): Promise<AddWordsResult> {
	const ids = [...new Set(o.entryIds)];
	const [bases, raw] = await Promise.all([o.bases(ids), o.raw()]);
	const items = ids.flatMap((id) => {
		const b = bases.get(id);
		return b === undefined ? [] : [{ entryId: id, written: b.written }];
	});
	const plan = planAddToDeck({
		items,
		target: o.target,
		existingDeck: raw.decks.find((d) => d.id === o.target.id) ?? null,
		rawCards: raw.cards,
		unreadable: raw.unreadable,
		now: o.now
	});
	const rows = addPlanRows(plan, raw);
	if (plan.writes.length > 0) await o.push(o.workspaceId, rows);
	return { created: plan.created, joined: plan.joined, skipped: plan.skipped, missing: ids.length - items.length };
}

/**
 * markWords marks (or unmarks) the ids whose mark differs from `marked`
 * (the live marks); undo reverses exactly the rows it wrote.
 */
export async function markWords(o: {
	workspaceId: number;
	entryIds: readonly number[];
	marked: ReadonlySet<number>;
	on: boolean;
	set: (workspaceId: number, entryIds: readonly number[], on: boolean) => Promise<void>;
}): Promise<{ written: number[]; undo: () => Promise<void> }> {
	const written = [...new Set(o.entryIds)].filter((id) => o.marked.has(id) !== o.on);
	if (written.length > 0) await o.set(o.workspaceId, written, o.on);
	return {
		written,
		undo: async () => {
			if (written.length > 0) await o.set(o.workspaceId, written, !o.on);
		}
	};
}

/** allNew: the new words of a list, in list order (learning words already have cards). */
export function allNew(list: readonly { entryId: number; state: 'new' | 'learning' }[]): number[] {
	return list.filter((item) => item.state === 'new').map((item) => item.entryId);
}
