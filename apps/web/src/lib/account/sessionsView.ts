// What the Sessions table of Settings → Account shows, derived from
// GET /api/account/sessions. Pure: the clock is passed in.

import { t } from '$lib/i18n';
import { formatRelative } from '$lib/i18n/format';

export interface SessionDto {
	id: number;
	device: string;
	createdAt: string;
	lastUsedAt: string;
	current: boolean;
}

export interface SessionRow {
	id: number;
	deviceLabel: string;
	/** "This device" on the caller's own row (text, not colour alone). */
	badge: string | null;
	signedIn: string;
	lastActive: string;
	current: boolean;
	/** The current row has no Revoke button: "Log out" is the way out. */
	canRevoke: boolean;
}

export function logoutEverywhereConfirm(): string {
	return t('account.sessions.logoutEverywhere');
}

function ago(n: number, unit: 'minute' | 'hour' | 'day'): string {
	return formatRelative(-n, unit);
}

// "1 September 2026" in the viewer's own zone (tz undefined), or the zone a
// test names; Intl does the calendar work, so no day arithmetic lives here.
function dateText(d: Date, tz?: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: tz
	}).format(d);
}

/** "just now", "5 minutes ago", ... up to 30 days, then "1 September 2026". */
export function relativeTime(iso: string, now: Date, tz?: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
	if (seconds < 45) return t('account.sessions.justNow');
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return ago(Math.max(minutes, 1), 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return ago(hours, 'hour');
	const days = Math.floor(hours / 24);
	if (days <= 30) return ago(days, 'day');
	return dateText(at, tz);
}

export function sessionRows(list: SessionDto[], now: Date, tz?: string): SessionRow[] {
	return list.map((s) => ({
		id: s.id,
		deviceLabel: s.device,
		badge: s.current ? t('account.sessions.thisDevice') : null,
		signedIn: dateText(new Date(s.createdAt), tz),
		lastActive: relativeTime(s.lastUsedAt, now, tz),
		current: s.current,
		canRevoke: !s.current
	}));
}
