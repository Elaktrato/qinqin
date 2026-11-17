import { t } from '$lib/i18n';

/**
 * resultCountText is the status line of a source search: the number of
 * results shown, or — when the server returned `limit` results, so more
 * may exist — a hint that the list is cut off. `shown` is what the list
 * displays (after any language filter), `returned` what the server sent.
 */
export function resultCountText(shown: number, returned: number, limit: number): string {
	if (returned >= limit) return t('reader.source.capped', { count: shown });
	return t('reader.source.results', { count: shown });
}
