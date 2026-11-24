import { describe, expect, it } from 'vitest';
import { previewLines } from './deleteView';

const zero = { workspaces: 0, studyEvents: 0, keyedRows: 0, books: 0, journalPhotos: 0, aiKeys: 0, sessions: 0, overlays: 0, sentences: 0 };

describe('previewLines', () => {
	it('words only what exists, singular and plural', () => {
		const lines = previewLines({ ...zero, workspaces: 1, studyEvents: 120, books: 2, sessions: 1 });
		expect(lines).toEqual([
			'1 workspace',
			'120 recorded reviews and study events',
			'2 books in the library, with their bookmarks and highlights',
			'1 signed-in session'
		]);
	});
	it('counts flashcards apart from the other saved items', () => {
		expect(previewLines({ ...zero, cards: 1, keyedRows: 2 })).toEqual([
			'1 flashcard, with its decks and study settings',
			'2 other saved items (notes, known words, settings)'
		]);
		expect(previewLines({ ...zero, cards: 3 })).toEqual(['3 flashcards, with their decks and study settings']);
	});
	it('counts the journal conversations', () => {
		expect(previewLines({ ...zero, journalEntries: 2, journalConversations: 1 })).toEqual(['2 journal entries, with their reviews', '1 journal conversation']);
	});
	it('counts access tokens', () => {
		expect(previewLines({ ...zero, accessTokens: 1 })).toEqual(['1 personal access token']);
		expect(previewLines({ ...zero, accessTokens: 3 })).toEqual(['3 personal access tokens']);
	});
	it('says so when there is nothing', () => {
		expect(previewLines(zero)).toEqual(['Nothing else: there is no data in this account yet.']);
	});
});
