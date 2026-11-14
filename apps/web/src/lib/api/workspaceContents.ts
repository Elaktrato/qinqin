// What a workspace holds, counted for the delete confirmation: its
// library books, its flashcard cards and decks, and its recorded
// reviews. Three reads the app already makes elsewhere (the library
// list, the study data sync pull, the activity events); nothing here is
// cached.

import { api } from './client';
import { listBooks } from './library';
import { FLASHCARDS_PLUGIN_ID } from '../study/store';

export interface WorkspaceContents {
	books: number;
	cards: number;
	decks: number;
	reviews: number;
}

interface Row {
	pluginId?: unknown;
	key?: unknown;
	workspaceId?: unknown;
	deletedAt?: unknown;
}

/** fetchWorkspaceContents counts what deleting workspace `id` removes. */
export async function fetchWorkspaceContents(id: number): Promise<WorkspaceContents> {
	const [books, delta, events] = await Promise.all([
		listBooks(id),
		api<{ pluginData?: unknown }>('/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData'),
		api<{ type?: unknown }[]>(`/api/events?workspace=${id}`)
	]);
	let cards = 0;
	let decks = 0;
	for (const row of Array.isArray(delta?.pluginData) ? (delta.pluginData as Row[]) : []) {
		if (row?.pluginId !== FLASHCARDS_PLUGIN_ID || row.workspaceId !== id) continue;
		if (row.deletedAt !== null && row.deletedAt !== undefined) continue;
		if (typeof row.key !== 'string') continue;
		if (row.key.startsWith('card:')) cards++;
		else if (row.key.startsWith('deck:')) decks++;
	}
	const reviews = Array.isArray(events) ? events.filter((event) => event?.type === 'review').length : 0;
	return { books: books.length, cards, decks, reviews };
}
