// What the Access tokens section of Settings → Account shows, derived from
// GET /api/account/tokens (docs/contracts/auth/tokens.json). Pure: the clock
// is passed in. The token itself never passes through here except into the
// example command of the one-time view.
import { relativeTime } from './sessionsView';
import { TOKEN_PREFIX } from './tokensFormat';

export interface TokenDto {
	id: number;
	name: string;
	hint: string;
	scope: 'read' | 'write';
	workspaceId: number | null;
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
	expired: boolean;
}

export const EXPIRY_CHOICES = [7, 30, 90, 365] as const;
export const DEFAULT_EXPIRY = 90;
export const MAX_TOKEN_NAME = 64;

export interface TokenRow {
	id: number;
	name: string;
	/** "qq_pat_3f9a1c…": the stored hint, never the token. */
	masked: string;
	scopeLabel: string;
	workspaceLabel: string;
	expiryText: string;
	lastUsedText: string;
	expired: boolean;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function count(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "Expires in 12 days", "Expires in 3 hours", "Expired" ('' for a bad date). */
export function expiryText(iso: string, expired: boolean, now: Date): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	const left = at.getTime() - now.getTime();
	if (expired || left <= 0) return 'Expired';
	// Rounded: a token made for 7 days reads "7 days" a few minutes later.
	if (left >= DAY) return `Expires in ${count(Math.round(left / DAY), 'day')}`;
	if (left >= HOUR) return `Expires in ${count(Math.floor(left / HOUR), 'hour')}`;
	return 'Expires in less than an hour';
}

function workspaceLabel(id: number | null, workspaces: { id: number; name: string }[]): string {
	if (id === null) return 'All workspaces';
	const ws = workspaces.find((w) => w.id === id);
	if (!ws) return 'Deleted workspace';
	return ws.name.trim() || `Workspace ${id}`;
}

export function tokenRows(list: TokenDto[], workspaces: { id: number; name: string }[], now: Date, tz?: string): TokenRow[] {
	return list.map((t) => ({
		id: t.id,
		name: t.name,
		masked: `${TOKEN_PREFIX}${t.hint}…`,
		scopeLabel: t.scope === 'write' ? 'Read and write' : 'Read only',
		workspaceLabel: workspaceLabel(t.workspaceId, workspaces),
		expiryText: expiryText(t.expiresAt, t.expired, now),
		lastUsedText: t.lastUsedAt ? `Last used ${relativeTime(t.lastUsedAt, now, tz)}` : 'Never used',
		expired: t.expired
	}));
}

export interface TokenForm {
	name: string;
	scope: string;
	days: number;
	password: string;
}

export type FormCheck = { ok: true } | { ok: false; field: string; message: string };

/** The server's own checks (422 invalid_token_request), run before sending. */
export function validateTokenForm(f: TokenForm): FormCheck {
	const name = f.name.trim();
	const runes = [...name].length;
	if (runes < 1 || runes > MAX_TOKEN_NAME) return { ok: false, field: 'name', message: 'The name must be 1 to 64 characters.' };
	if (f.scope !== 'read' && f.scope !== 'write') return { ok: false, field: 'scope', message: 'Choose read only or read and write.' };
	if (!Number.isInteger(f.days) || f.days < 1 || f.days > 365) return { ok: false, field: 'days', message: 'The expiry must be 1 to 365 days.' };
	if (f.password === '') return { ok: false, field: 'password', message: 'Enter your current password.' };
	return { ok: true };
}

/** A first command to try the token with: list the workspaces. */
export function exampleCommand(origin: string, token: string): string {
	return `curl -sS -H "Authorization: Bearer ${token}" ${origin.replace(/\/+$/, '')}/api/workspaces`;
}

/** The line a sign-out or password-change confirmation adds when tokens exist. */
export function containmentNote(tokenCount: number): string | null {
	return tokenCount > 0 ? 'Your access tokens are revoked too.' : null;
}
