// What a workspace holds, counted for the delete confirmation: its
// library books, its flashcard cards and decks, and its recorded
// reviews. Cards are counted as every study page shows them: through
// loadStudyData, so duplicates of one word (added on two devices before
// card ids were deterministic) count once. Nothing here is cached.

import { listBooks } from './library';
import { loadStudyData } from '../study/store';

export interface WorkspaceContents {
	books: number;
	cards: number;
	decks: number;
	reviews: number;
}

/** fetchWorkspaceContents counts what deleting workspace `id` removes. */
export async function fetchWorkspaceContents(id: number): Promise<WorkspaceContents> {
	const [books, study] = await Promise.all([listBooks(id), loadStudyData(id)]);
	return {
		books: books.length,
		cards: study.cards.length,
		decks: study.decks.length,
		reviews: study.reviews.length
	};
}
