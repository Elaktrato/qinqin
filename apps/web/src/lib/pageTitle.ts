import { t } from './i18n';

/**
 * pageTitle builds a document title: the most specific part first, the
 * app name last (`Characters · Stats · qinqin`). Empty parts are skipped;
 * with none left it is just the app name.
 */
export function pageTitle(...parts: string[]): string {
	return [...parts.map((p) => p.trim()).filter(Boolean), t('app.name')].join(' · ');
}
