import type { DeletionPreview } from '$lib/api/adminUsers';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * previewLines words the deletion preview as the list the dialog shows
 * (admin deletion and self-deletion): only the kinds that exist, so nothing
 * is promised that is not there.
 */
export function previewLines(p: DeletionPreview): string[] {
	const lines: string[] = [];
	if (p.workspaces) lines.push(plural(p.workspaces, 'workspace', 'workspaces'));
	if (p.studyEvents) lines.push(plural(p.studyEvents, 'recorded review and study event', 'recorded reviews and study events'));
	if (p.cards) lines.push(plural(p.cards, 'flashcard, with its decks and study settings', 'flashcards, with their decks and study settings'));
	if (p.pluginData) lines.push(plural(p.pluginData, 'other saved item (journal entries, notes, known words, settings)', 'other saved items (journal entries, notes, known words, settings)'));
	if (p.books) lines.push(plural(p.books, 'book in the library, with its bookmarks and highlights', 'books in the library, with their bookmarks and highlights'));
	if (p.overlays) lines.push(plural(p.overlays, 'edited dictionary entry', 'edited dictionary entries'));
	if (p.sentences) lines.push(plural(p.sentences, 'sentence they added', 'sentences they added'));
	if (p.journalPhotos) lines.push(plural(p.journalPhotos, 'journal photo draft', 'journal photo drafts'));
	if (p.aiKeys) lines.push(plural(p.aiKeys, 'stored AI key', 'stored AI keys'));
	if (p.sessions) lines.push(plural(p.sessions, 'signed-in session', 'signed-in sessions'));
	if (p.accessTokens) lines.push(plural(p.accessTokens, 'personal access token', 'personal access tokens'));
	if (lines.length === 0) lines.push('Nothing else: there is no data in this account yet.');
	return lines;
}
