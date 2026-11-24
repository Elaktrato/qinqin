import type { DeletionPreview } from '$lib/api/adminUsers';
import { t, type MessageKey } from '$lib/i18n';

const LINES: [keyof DeletionPreview, MessageKey][] = [
	['workspaces', 'admin.delete.preview.workspaces'],
	['studyEvents', 'admin.delete.preview.studyEvents'],
	['cards', 'admin.delete.preview.cards'],
	['keyedRows', 'admin.delete.preview.keyedRows'],
	['books', 'admin.delete.preview.books'],
	['overlays', 'admin.delete.preview.overlays'],
	['sentences', 'admin.delete.preview.sentences'],
	['journalEntries', 'admin.delete.preview.journalEntries'],
	['journalPhotos', 'admin.delete.preview.journalPhotos'],
	['aiKeys', 'admin.delete.preview.aiKeys'],
	['sessions', 'admin.delete.preview.sessions'],
	['accessTokens', 'admin.delete.preview.accessTokens']
];

/**
 * previewLines words the deletion preview as the list the dialog shows
 * (admin deletion and self-deletion): only the kinds that exist, so nothing
 * is promised that is not there.
 */
export function previewLines(p: DeletionPreview): string[] {
	const lines: string[] = [];
	for (const [field, key] of LINES) {
		const count = p[field];
		if (count) lines.push(t(key, { count }));
	}
	if (lines.length === 0) lines.push(t('admin.delete.preview.nothing'));
	return lines;
}
