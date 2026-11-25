// Pure logic of Settings -> Admin -> Updates.
import { t } from '$lib/i18n';
import type { UpdateError, UpdateStatus } from '$lib/api/adminUpdate';

/** The release page link is shown only for a GitHub URL (the server checks it too). */
export function safeReleaseUrl(url: string): string | null {
	return url.startsWith('https://github.com/') ? url : null;
}

const ERROR_TEXT = {
	offline: 'admin.update.error.offline',
	rate_limited: 'admin.update.error.rateLimited',
	bad_response: 'admin.update.error.badResponse'
} as const satisfies Record<UpdateError, string>;

/** The one sentence that says where the instance stands. */
export function statusLine(s: UpdateStatus): string {
	const c = s.check;
	if (c.state === 'disabled') return t('admin.update.state.disabled');
	if (c.state === 'unchecked') return t('admin.update.state.unchecked');
	if (c.state === 'error' && !c.latest) return t(ERROR_TEXT[c.error ?? 'bad_response']);
	if (!c.latest) return t('admin.update.state.noRelease');
	switch (c.update) {
		case 'available':
			return t('admin.update.state.available', { version: c.latest.version });
		case 'current':
			return t('admin.update.state.current');
		case 'ahead':
			return t('admin.update.state.ahead');
		default:
			return t('admin.update.state.unknown');
	}
}

/** The offline or rate-limit note beside a stale answer; '' when the last check went well. */
export function errorNote(s: UpdateStatus): string {
	const c = s.check;
	if (c.state !== 'error' || !c.latest) return '';
	return `${t(ERROR_TEXT[c.error ?? 'bad_response'])} ${t('admin.update.stale')}`;
}

/** Whether "Check now" does anything: a disabled check never contacts GitHub. */
export function canCheck(s: UpdateStatus | null, busy: boolean): boolean {
	return s !== null && s.settings.enabled && !busy;
}
