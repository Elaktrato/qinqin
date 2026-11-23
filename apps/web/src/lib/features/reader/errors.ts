import { ApiError } from '$lib/api/client';
import { languageLabel } from '$lib/languages';
import { API_ERROR_KEYS } from '$lib/api/apiErrors';
import { t, type MessageKey } from '$lib/i18n';

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
	| 'bookmarkAdd'
	| 'bookmarks'
	| 'highlight'
	| 'highlightAdd'
	| 'highlights'
	| 'display';

const fallbacks: Record<ErrorContext, MessageKey> = {
	upload: 'reader.error.upload',
	import: 'reader.error.import',
	list: 'reader.error.list',
	delete: 'reader.error.delete',
	search: 'reader.error.search',
	browse: 'reader.error.browse',
	book: 'reader.error.book',
	chapter: 'reader.error.chapter',
	lookup: 'reader.error.lookup',
	bookmark: 'reader.error.bookmark',
	bookmarkAdd: 'reader.error.bookmark',
	bookmarks: 'reader.error.bookmarks',
	highlight: 'reader.error.highlight',
	highlightAdd: 'reader.error.highlight',
	highlights: 'reader.error.highlights',
	display: 'reader.error.display'
};

// A 404 from a book-scoped request whose only id is the book's (opening
// it, a chapter, the bookmark or highlight lists, adding one) means the
// book itself is gone: deleted, or its workspace deleted in another tab
// or on another device. The reader never asks for a chapter out of range.
const BOOK_GONE: MessageKey = 'reader.error.bookGone';

const notFound: Partial<Record<ErrorContext, MessageKey>> = {
	import: 'reader.error.workGone',
	book: BOOK_GONE,
	chapter: BOOK_GONE,
	bookmarks: BOOK_GONE,
	highlights: BOOK_GONE,
	bookmarkAdd: BOOK_GONE,
	highlightAdd: BOOK_GONE,
	bookmark: 'reader.error.bookmarkGone',
	highlight: 'reader.error.highlightGone'
};

// Adding is a write of the same kind for the cap and size messages.
function writeKind(context: ErrorContext): ErrorContext {
	if (context === 'bookmarkAdd') return 'bookmark';
	if (context === 'highlightAdd') return 'highlight';
	return context;
}

// The library's refusal of a book whose language is not the workspace's:
// 422 language_mismatch naming both languages.
function mismatchOf(err: ApiError): { workspace: string; book: string } | null {
	if (err.code !== 'language_mismatch') return null;
	const workspace = err.body?.workspaceLanguage;
	const book = err.body?.bookLanguage;
	return typeof workspace === 'string' && typeof book === 'string' ? { workspace, book } : null;
}

/** Turns an API failure into a short, friendly sentence for the UI. */
export function apiErrorMessage(err: unknown, context: ErrorContext): string {
	if (err instanceof ApiError) {
		const kind = writeKind(context);
		const mismatch = mismatchOf(err);
		if (mismatch) {
			return t('reader.error.mismatch', {
				book: languageLabel(mismatch.book),
				workspace: languageLabel(mismatch.workspace)
			});
		}
		switch (err.status) {
			case 409:
				if (kind === 'bookmark') {
					return t('reader.error.bookmarkCap');
				}
				// An overlap (409 with existingId) is handled by the caller,
				// which opens the existing highlight; what reaches here is the cap.
				if (kind === 'highlight') {
					return t('reader.error.highlightCap');
				}
				return t('reader.error.alreadyInLibrary');
			case 413:
				if (kind === 'highlight' || kind === 'highlights') {
					return t('reader.error.highlightTooLong');
				}
				return t('reader.error.fileTooLarge');
			case 422:
				if (context === 'upload') {
					return t('reader.error.unreadable');
				}
				break;
			case 429:
				return t('reader.error.importBusy');
			case 502:
				return t('reader.error.sourceDown');
			case 404: {
				const gone = notFound[context];
				if (gone !== undefined) return t(gone);
				break;
			}
			case 501:
				if (context === 'browse') return t('reader.error.noSuggestions');
				break;
		}
		// A known code shows its catalogue text; the server's English message never shows (#168).
		const code = err.code;
		if (code !== undefined && Object.hasOwn(API_ERROR_KEYS, code)) return t(API_ERROR_KEYS[code]);
	}
	return t(fallbacks[context]);
}
