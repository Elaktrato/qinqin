// What the Access tokens section of Settings → Account shows, derived from
// GET /api/account/tokens (docs/contracts/auth/tokens.json). Pure: the clock
// is passed in. The token itself never passes through here except into the
// example command of the one-time view.
import { t } from '../i18n';
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

/** "Expires in 12 days", "Expires in 3 hours", "Expired" ('' for a bad date). */
export function expiryText(iso: string, expired: boolean, now: Date): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	const left = at.getTime() - now.getTime();
	if (expired || left <= 0) return t('settings.tokens.expired');
	// Rounded: a token made for 7 days reads "7 days" a few minutes later.
	if (left >= DAY) return t('settings.tokens.expiresInDays', { count: Math.round(left / DAY) });
	if (left >= HOUR) return t('settings.tokens.expiresInHours', { count: Math.floor(left / HOUR) });
	return t('settings.tokens.expiresSoon');
}

function workspaceLabel(id: number | null, workspaces: { id: number; name: string }[]): string {
	if (id === null) return t('settings.tokens.allWorkspaces');
	const ws = workspaces.find((w) => w.id === id);
	if (!ws) return t('settings.tokens.deletedWorkspace');
	return ws.name.trim() || t('settings.tokens.workspaceN', { id });
}

function lastUsed(iso: string, now: Date, tz?: string): string {
	return t('settings.tokens.lastUsed', { when: relativeTime(iso, now, tz) });
}

/** The access a scope gives, as the list and the form's radio labels say it. */
export function scopeText(scope: 'read' | 'write'): string {
	return scope === 'write' ? t('settings.tokens.readWrite') : t('settings.tokens.readOnly');
}

export function tokenRows(list: TokenDto[], workspaces: { id: number; name: string }[], now: Date, tz?: string): TokenRow[] {
	return list.map((tok) => ({
		id: tok.id,
		name: tok.name,
		masked: `${TOKEN_PREFIX}${tok.hint}…`,
		scopeLabel: scopeText(tok.scope),
		workspaceLabel: workspaceLabel(tok.workspaceId, workspaces),
		expiryText: expiryText(tok.expiresAt, tok.expired, now),
		lastUsedText: tok.lastUsedAt ? lastUsed(tok.lastUsedAt, now, tz) : t('settings.tokens.neverUsed'),
		expired: tok.expired
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
	if (runes < 1 || runes > MAX_TOKEN_NAME) return { ok: false, field: 'name', message: t('settings.tokens.form.nameLength') };
	if (f.scope !== 'read' && f.scope !== 'write') return { ok: false, field: 'scope', message: t('settings.tokens.form.chooseScope') };
	if (!Number.isInteger(f.days) || f.days < 1 || f.days > 365) return { ok: false, field: 'days', message: t('settings.tokens.form.expiryRange') };
	if (f.password === '') return { ok: false, field: 'password', message: t('settings.tokens.form.passwordMissing') };
	return { ok: true };
}

/** A first command to try the token with: list the workspaces. */
export function exampleCommand(origin: string, token: string): string {
	return `curl -sS -H "Authorization: Bearer ${token}" ${origin.replace(/\/+$/, '')}/api/workspaces`;
}

/** The line a sign-out or password-change confirmation adds when tokens exist. */
export function containmentNote(tokenCount: number): string | null {
	return tokenCount > 0 ? t('settings.tokens.revokedToo') : null;
}
