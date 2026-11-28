// Removing an own sentence of an entry (#279, docs/contracts/reader/README.md
// "Saved sentences"): the sentence is deleted on the server, then the
// sentence (Word Salad) cards made from it are tombstoned in every
// workspace given (those of the entry's language). Reviews stay in the log.

import type { StudyCard } from '$lib/studycore/types';

/** The ids of the word's sentence cards on that sentence. */
export function sentenceCardIds(cards: readonly StudyCard[], entryId: number, sentenceId: number): string[] {
	return cards
		.filter((c) => c.kind === 'sentence' && c.entryId === entryId && c.sentenceId === sentenceId)
		.map((c) => c.id);
}

/** The calls removeOwnSentence makes (injected; the entry page passes the real ones). */
export interface RemoveDeps {
	remove(entryId: number, sentenceId: number): Promise<void>;
	/** The workspaces whose cards follow (the entry's language). */
	workspaces: readonly number[];
	cards(workspaceId: number): Promise<readonly StudyCard[]>;
	/** deleteCards: tombstones the cards and their stored duplicates. */
	deleteCards(workspaceId: number, ids: readonly string[]): Promise<unknown>;
}

/**
 * removeOwnSentence deletes the sentence (a failure throws and changes
 * nothing), then its cards. `cardsLeft` is true when a workspace's cards
 * could not be read or removed: such a card stays and shows the word's
 * first sentence.
 */
export async function removeOwnSentence(
	deps: RemoveDeps,
	entryId: number,
	sentenceId: number
): Promise<{ cardsLeft: boolean }> {
	await deps.remove(entryId, sentenceId);
	let cardsLeft = false;
	for (const ws of deps.workspaces) {
		try {
			const ids = sentenceCardIds(await deps.cards(ws), entryId, sentenceId);
			if (ids.length > 0) await deps.deleteCards(ws, ids);
		} catch {
			cardsLeft = true;
		}
	}
	return { cardsLeft };
}
