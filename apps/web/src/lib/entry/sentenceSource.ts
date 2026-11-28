// The source line of a saved book sentence (#280,
// docs/contracts/reader/sentence-sources.json): "From title, chapter n" in
// place of the user number, linking to the reader at the word while the
// book is there.
import { t } from '$lib/i18n';
import type { SentenceSource } from '$lib/api/types';
import { sourceHref } from '$lib/features/reader/route';

export interface SourceLabel {
	/** The book's title; null for an untitled book. */
	title: string | null;
	/** The chapter, one-based. */
	chapter: number;
	/** The reader link; null once the book is deleted. */
	href: string | null;
}

/** sourceLabel: what the line shows (contract `label`). */
export function sourceLabel(source: SentenceSource): SourceLabel {
	const title = source.title.trim();
	return { title: title === '' ? null : title, chapter: source.chapter + 1, href: sourceHref(source) };
}

/** sourceText is the line as text: "From Book, chapter 3" (shared text, screen readers). */
export function sourceText(source: SentenceSource): string {
	const l = sourceLabel(source);
	return l.title === null
		? t('entry.sentences.sourceUntitled', { n: l.chapter })
		: t('entry.sentences.source', { title: l.title, n: l.chapter });
}
