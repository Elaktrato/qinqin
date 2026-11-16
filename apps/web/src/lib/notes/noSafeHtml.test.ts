import { describe, expect, it } from 'vitest';

// Notes are untrusted text (a synced or restored row is just bytes): the
// components that show them and the pages hosting them never render HTML.
const notes = import.meta.glob('./*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const pages = import.meta.glob(['../../routes/entry/[[]id]/+page.svelte', '../../routes/study/session/+page.svelte'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const UNSAFE = ['{@html', 'innerHTML', 'outerHTML', 'insertAdjacentHTML'];

describe('note rendering', () => {
	it('finds the note components and the host pages', () => {
		expect(Object.keys(notes).sort()).toEqual(['./EntryNote.svelte', './NoteAnswer.svelte']);
		expect(Object.keys(pages).length).toBe(2);
	});

	it.each(Object.entries({ ...notes, ...pages }))('%s renders no raw HTML', (_name, src) => {
		for (const bad of UNSAFE) expect(src.includes(bad), bad).toBe(false);
	});
});
