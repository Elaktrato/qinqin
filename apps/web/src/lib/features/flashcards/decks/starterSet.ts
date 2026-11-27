// The Starter set (#214) as a deck the learner owns: the words of a shipped set (GET /api/starter-sets/{id}) are
// copied into the deck `d-starter-<language>` with the ordinary add-to-deck plan, so they stay in the learner's own
// vocabulary (the same card ids and history as any word) and Starter mode is only a display rule over them.
// Idempotent: a word that already has a card joins the deck, a second run adds nothing.

import { starterSet, type StarterSetEntry } from '$lib/api/starter';
import { loadRawStudyData, getStudyData } from '$lib/studycore/data';
import { pushStudy } from '$lib/studycore/commands/write';
import { starterSetDeckId } from '$lib/starter/starter';
import type { useSession } from '$lib/context/context';
import { addPlanRows, planAddToDeck, type AddItem, type AddPlan } from './addToDeck';

/** The deck a set is copied into: a plain deck (no `source`, so no deck row shape changes) with a fixed id. */
export function starterSetTarget(set: { language: string; name: string }): { id: string; name: string } {
	return { id: starterSetDeckId(set.language), name: set.name };
}

/** The add items of a set's words, in the set's order; a character entry gets no sentence or tone companions. */
export function starterSetItems(entries: readonly StarterSetEntry[]): AddItem[] {
	return entries.map((entry) => ({
		entryId: entry.id,
		written: entry.written,
		...(entry.kind === 'character' ? { entryKind: 'character' as const } : {})
	}));
}

export interface StarterSetResult {
	/** Cards created or joined into the deck. */
	added: number;
	/** Words left out because the learner marked them known. */
	known: number;
	/** The set had no word the installed dictionaries know. */
	empty: boolean;
	plan: AddPlan;
}

/**
 * addStarterSet copies the set into the learner's deck. Words marked known are left out; words that already have
 * a card join the deck; the deck's new cards study in the set's order.
 */
export async function addStarterSet(
	session: ReturnType<typeof useSession>,
	workspaceId: number,
	setId: string,
	opts: { onProgress?: (done: number, total: number) => void } = {}
): Promise<StarterSetResult> {
	const body = await starterSet(setId);
	const entries = Array.isArray(body?.entries) ? body.entries : [];
	if (entries.length === 0) {
		return { added: 0, known: 0, empty: true, plan: { deck: null, writes: [], created: 0, joined: 0, skipped: 0 } };
	}
	const data = await getStudyData(session.study, workspaceId, { force: true });
	const raw = await loadRawStudyData(session.study, workspaceId);
	const target = starterSetTarget(body);
	const plan = planAddToDeck({
		items: starterSetItems(entries),
		target: { ...target, name: raw.decks.find((d) => d.id === target.id)?.name ?? target.name },
		existingDeck: raw.decks.find((d) => d.id === target.id) ?? null,
		rawCards: raw.cards,
		unreadable: raw.unreadable,
		now: new Date(),
		exclude: new Set(data.known ?? []),
		settings: { newOrder: { by: 'added' }, exists: raw.deckSettings?.[target.id] !== undefined }
	});
	const rows = addPlanRows(plan, raw);
	if (rows.length > 0) {
		const head = rows.length - plan.writes.length;
		await pushStudy(session.study, workspaceId, rows, {
			onProgress: (done, total) => opts.onProgress?.(Math.max(0, done - head), Math.max(0, total - head))
		});
	}
	return { added: plan.created + plan.joined, known: plan.known ?? 0, empty: false, plan };
}
