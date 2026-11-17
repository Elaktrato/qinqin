// A book's reading position is stored server-side as "<chapter>:<paragraph>".
import { t } from '$lib/i18n';

export interface Position {
	chapter: number;
	paragraph: number;
}

export function formatPosition(chapter: number, paragraph: number): string {
	return `${chapter}:${paragraph}`;
}

function parseIndex(part: string): number | null {
	if (!/^\d+$/.test(part)) return null;
	const n = Number(part);
	return Number.isSafeInteger(n) ? n : null;
}

/** parsePosition reads a stored position; anything malformed is null. */
export function parsePosition(s: string): Position | null {
	const parts = s.split(':');
	if (parts.length !== 2) return null;
	const chapter = parseIndex(parts[0]);
	const paragraph = parseIndex(parts[1]);
	if (chapter === null || paragraph === null) return null;
	return { chapter, paragraph };
}

/**
 * savedChapter is the chapter a library link opens: the chapter of the
 * saved position, clamped to the book's last chapter; 0 when nothing
 * (valid) is saved.
 */
export function savedChapter(position: string, chapterCount: number): number {
	const chapter = parsePosition(position)?.chapter ?? 0;
	return Math.max(0, Math.min(chapter, chapterCount - 1));
}

/** chapterTitle is what the reader shows for chapter n: its title, else "Chapter n+1". */
export function chapterTitle(title: string, n: number): string {
	return title.trim() || t('reader.chapter', { n: n + 1 });
}
