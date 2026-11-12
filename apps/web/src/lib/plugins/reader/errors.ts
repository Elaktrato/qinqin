import { ApiError } from '$lib/api/client';

export type ErrorContext =
	| 'upload'
	| 'import'
	| 'list'
	| 'delete'
	| 'search'
	| 'book'
	| 'chapter'
	| 'lookup';

const fallbacks: Record<ErrorContext, string> = {
	upload: 'Could not upload the file.',
	import: 'Could not import this work.',
	list: 'Could not load your library.',
	delete: 'Could not delete the book.',
	search: 'Could not search the source.',
	book: 'Could not load this book.',
	chapter: 'Could not load this chapter.',
	lookup: 'Could not look this up.'
};

const notFound: Partial<Record<ErrorContext, string>> = {
	import: 'This work is not available from the source.',
	book: 'This book is not in your library.',
	chapter: 'This chapter does not exist.'
};

// Server text is shown only when it is short and free of markup.
function isPlain(text: string): boolean {
	return text.length > 0 && text.length <= 120 && !/[<>]/.test(text) && !text.includes('\n');
}

/** Turns an API failure into a short, friendly sentence for the UI. */
export function apiErrorMessage(err: unknown, context: ErrorContext): string {
	if (err instanceof ApiError) {
		switch (err.status) {
			case 409:
				return 'This book is already in your library.';
			case 413:
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
		}
		const text = err.message.trim();
		if (isPlain(text)) return text;
	}
	return fallbacks[context];
}
