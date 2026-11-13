import { ApiError } from '$lib/api/client';
import { languageLabel } from '$lib/languages';

export type ErrorContext =
	| 'upload'
	| 'import'
	| 'list'
	| 'delete'
	| 'search'
	| 'browse'
	| 'book'
	| 'chapter'
	| 'lookup'
	| 'bookmark'
	| 'bookmarks'
	| 'highlight'
	| 'highlights';

const fallbacks: Record<ErrorContext, string> = {
	upload: 'Could not upload the file.',
	import: 'Could not import this work.',
	list: 'Could not load your library.',
	delete: 'Could not delete the book.',
	search: 'Could not search the source.',
	browse: 'Could not load suggestions.',
	book: 'Could not load this book.',
	chapter: 'Could not load this chapter.',
	lookup: 'Could not look this up.',
	bookmark: 'Could not save the bookmark.',
	bookmarks: 'Could not load the bookmarks.',
	highlight: 'Could not save the highlight.',
	highlights: 'Could not load the highlights.'
};

const notFound: Partial<Record<ErrorContext, string>> = {
	import: 'This work is not available from the source.',
	book: 'This book is not in your library.',
	chapter: 'This chapter does not exist.',
	bookmark: 'This bookmark no longer exists.',
	highlight: 'This highlight no longer exists.'
};

// Server text is shown only when it is short and free of markup.
function isPlain(text: string): boolean {
	return text.length > 0 && text.length <= 120 && !/[<>]/.test(text) && !text.includes('\n');
}

// The library's refusal of a book whose language is not the workspace's.
const MISMATCH = /^workspace language is ([a-z0-9-]+), book is ([a-z0-9-]+)$/i;

/** Turns an API failure into a short, friendly sentence for the UI. */
export function apiErrorMessage(err: unknown, context: ErrorContext): string {
	if (err instanceof ApiError) {
		const mismatch = err.status === 422 ? MISMATCH.exec(err.message.trim()) : null;
		if (mismatch) {
			const workspace = languageLabel(mismatch[1]);
			const book = languageLabel(mismatch[2]);
			return `This book is in ${book}, but this workspace is ${workspace}. Switch to a ${book} workspace to add it.`;
		}
		switch (err.status) {
			case 409:
				if (context === 'bookmark') {
					return 'This book already has the most bookmarks allowed (200). Delete one to add another.';
				}
				// An overlap (409 with existingId) is handled by the caller,
				// which opens the existing highlight; what reaches here is the cap.
				if (context === 'highlight') {
					return 'This book already has the most highlights allowed (2000). Delete one to add another.';
				}
				return 'This book is already in your library.';
			case 413:
				if (context === 'highlight' || context === 'highlights') {
					return 'This highlight or its note is too long to save.';
				}
				return 'This file is too large (max 20 MB).';
			case 422:
				if (context === 'upload') {
					return 'This file could not be read as an epub, or its language is not Chinese or Japanese.';
				}
				break;
			case 429:
				return 'Another import is already running, try again in a moment.';
			case 502:
				return 'The source is unavailable right now, try again later.';
			case 404:
				if (notFound[context]) return notFound[context];
				break;
			case 501:
				if (context === 'browse') return 'This source has no suggestions. Search it instead.';
				break;
		}
		const text = err.message.trim();
		if (isPlain(text)) return text;
	}
	return fallbacks[context];
}
