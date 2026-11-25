import { t } from '$lib/i18n';
import type { JournalEntry } from './types';

const MAX = 60;

/** The list label: the title, else the first non-empty line, else "Untitled entry". */
export function entryLabel(entry: Pick<JournalEntry, 'title' | 'text'>): string {
	const title = entry.title.trim();
	if (title) return title;
	const line = entry.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
	if (!line) return t('journal.untitled');
	const chars = [...line];
	return chars.length > MAX ? chars.slice(0, MAX).join('') + '…' : line;
}
