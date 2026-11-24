import { describe, expect, it, vi } from 'vitest';
import { recordLookup } from './sink';

describe('recordLookup', () => {
	it('notes the lookup in the given workspace', () => {
		const note = vi.fn();
		recordLookup({ note }, 3, { entryId: 7, source: 'reader', bookId: 12 });
		expect(note).toHaveBeenCalledExactlyOnceWith(3, { entryId: 7, source: 'reader', bookId: 12 });
	});

	it('without a workspace records nothing', () => {
		const note = vi.fn();
		recordLookup({ note }, null, { entryId: 7, source: 'reader', bookId: 12 });
		recordLookup({ note }, undefined, { entryId: 7, source: 'lesson' });
		expect(note).not.toHaveBeenCalled();
	});

	it('drops a book id that is not a positive integer', () => {
		const note = vi.fn();
		recordLookup({ note }, 3, { entryId: 7, source: 'reader', bookId: undefined });
		expect(note).toHaveBeenCalledExactlyOnceWith(3, { entryId: 7, source: 'reader' });
	});
});

describe('the reader and lessons pass the right source', () => {
	it('BookView records reader lookups with the book id in the book workspace', async () => {
		const src = (await import('../features/reader/BookView.svelte?raw')).default;
		expect(src).toMatch(/onLookup:\s*\(entryId\)\s*=>\s*recordLookup\(session\.lookups\.recorder,\s*studyWorkspaceId,\s*\{\s*entryId,\s*source:\s*'reader',\s*bookId:\s*book\?\.id\s*\}\)/);
		expect(src).toContain('session.lookups.recorder.load(');
	});

	it('LessonView records lesson lookups in the study workspace', async () => {
		const src = (await import('../plugins/grammar/LessonView.svelte?raw')).default;
		expect(src).toMatch(/onLookup:\s*\(entryId\)\s*=>\s*recordLookup\(session\.lookups\.recorder,\s*studyWorkspaceId,\s*\{\s*entryId,\s*source:\s*'lesson'\s*\}\)/);
	});
});
