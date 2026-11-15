// What the Sessions table of Settings → Account shows, derived from
// GET /api/account/sessions. Pure: the clock is passed in.

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

export const LOGOUT_EVERYWHERE_CONFIRM =
	'Log out everywhere? Every device, including this one, will need to sign in again.';

const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

function dateText(d: Date): string {
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "just now", "5 minutes ago", ... up to 30 days, then "1 September 2026". */
export function relativeTime(iso: string, now: Date): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
	if (seconds < 45) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return plural(Math.max(minutes, 1), 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return plural(hours, 'hour');
	const days = Math.floor(hours / 24);
	if (days <= 30) return plural(days, 'day');
	return dateText(at);
}

export function sessionRows(list: SessionDto[], now: Date): SessionRow[] {
	return list.map((s) => ({
		id: s.id,
		deviceLabel: s.device,
		badge: s.current ? 'This device' : null,
		signedIn: dateText(new Date(s.createdAt)),
		lastActive: relativeTime(s.lastUsedAt, now),
		current: s.current,
		canRevoke: !s.current
	}));
}
