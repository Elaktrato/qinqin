import type { AdminUserDto } from '$lib/api/adminUsers';
import { t, type MessageKey } from '$lib/i18n';
import { formatRelative } from '$lib/i18n/format';
import { hasSecondStep } from './mfaResetView';
import { userPatchNeedsReauth, type UserPatchChange } from './adminReauthRules';

/** Actions that always ask the acting administrator for their own password (and code, with an authenticator) first. */
const ALWAYS_REAUTH: ReadonlySet<UserActionId> = new Set(['makeAdmin', 'resetLink', 'delete']);

/** The PATCH a row action sends (none for the other actions). */
export function actionPatch(id: UserActionId): UserPatchChange | null {
	switch (id) {
		case 'makeAdmin':
			return { admin: true };
		case 'removeAdmin':
			return { admin: false };
		case 'disable':
			return { disabled: true };
		case 'enable':
			return { disabled: false };
		case 'requirePasswordChange':
			return { mustChangePassword: true };
		default:
			return null;
	}
}

/**
 * Whether a row action asks for re-authentication first, by the server's
 * rule (docs/contracts/auth/admin-reauth.json). The two-step reset has its
 * own dialog with the same fields.
 */
export function actionNeedsReauth(id: UserActionId, target: { admin: boolean; self: boolean }): boolean {
	if (ALWAYS_REAUTH.has(id)) return true;
	const p = actionPatch(id);
	return p !== null && userPatchNeedsReauth(target.admin, target.self, p);
}

export function lastAdminReason(): string {
	return t('admin.users.lastAdminReason');
}

export type UserActionId =
	| 'makeAdmin'
	| 'removeAdmin'
	| 'disable'
	| 'enable'
	| 'requirePasswordChange'
	| 'resetLink'
	| 'revokeResetLink'
	| 'signOutEverywhere'
	| 'resetMfa'
	| 'removePicture'
	| 'delete';

export interface UserAction {
	id: UserActionId;
	label: string;
	disabled: boolean;
	/** Why the action is unavailable, shown as text (the server still decides). */
	reason?: string;
}

export interface UserRow {
	id: number;
	username: string;
	email: string;
	/** "Administrator" or "User", in the interface language. */
	role: string;
	/** Text badges, never colour alone. */
	status: string[];
	lastSeen: string;
	self: boolean;
	/** The profile picture's path, or null: the letter. */
	avatarUrl: string | null;
	actions: UserAction[];
}

const ACTION_LABELS: Record<UserActionId, MessageKey> = {
	makeAdmin: 'admin.users.action.makeAdmin',
	removeAdmin: 'admin.users.action.removeAdmin',
	disable: 'admin.users.action.disable',
	enable: 'admin.users.action.enable',
	requirePasswordChange: 'admin.users.action.requirePasswordChange',
	resetLink: 'admin.users.action.resetLink',
	revokeResetLink: 'admin.users.action.revokeResetLink',
	signOutEverywhere: 'admin.users.action.signOutEverywhere',
	resetMfa: 'admin.users.action.resetMfa',
	removePicture: 'admin.users.action.removePicture',
	delete: 'admin.users.action.delete'
};

/** "Never", "Just now", "5 minutes ago", ... from an injected now. */
export function lastSeenLabel(iso: string | null, now: Date): string {
	if (!iso) return t('admin.users.lastSeen.never');
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return t('admin.users.lastSeen.never');
	const minutes = Math.floor((now.getTime() - then) / 60000);
	if (minutes < 1) return t('admin.users.lastSeen.justNow');
	if (minutes < 60) return formatRelative(-minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return formatRelative(-hours, 'hour');
	return formatRelative(-Math.floor(hours / 24), 'day');
}

/** The active administrators: admin and not disabled. */
function activeAdmins(users: readonly AdminUserDto[]): number {
	return users.filter((u) => u.admin && !u.disabled).length;
}

/**
 * userRows turns the server's user list into table rows with the actions
 * each row offers. The own row has no disable and no delete (Settings,
 * Account deletes yourself) and no two-step reset; "Reset two-step sign-in"
 * appears only for a user who has a second step; the last active administrator cannot be
 * demoted, disabled or deleted, and says why.
 */
export function userRows(users: readonly AdminUserDto[], selfId: number, now: Date): UserRow[] {
	const admins = activeAdmins(users);
	return users.map((u) => {
		const self = u.id === selfId;
		const lastAdmin = u.admin && !u.disabled && admins <= 1;
		const guard = (id: UserActionId): UserAction => ({
			id,
			label: t(ACTION_LABELS[id]),
			disabled: lastAdmin,
			...(lastAdmin ? { reason: lastAdminReason() } : {})
		});
		const plain = (id: UserActionId): UserAction => ({ id, label: t(ACTION_LABELS[id]), disabled: false });
		const actions: UserAction[] = [u.admin ? guard('removeAdmin') : plain('makeAdmin')];
		if (!self) actions.push(u.disabled ? plain('enable') : guard('disable'));
		actions.push(plain('requirePasswordChange'), plain('resetLink'), plain('revokeResetLink'), plain('signOutEverywhere'));
		// Not for oneself: Settings, Account manages one's own factors (the server answers self_target).
		if (!self && hasSecondStep(u)) actions.push(plain('resetMfa'));
		if (u.avatarUrl) actions.push(plain('removePicture'));
		if (!self) actions.push(guard('delete'));
		const status = [u.disabled ? t('admin.users.status.disabled') : t('admin.users.status.active')];
		if (u.mustChangePassword) status.push(t('admin.users.status.mustChangePassword'));
		return {
			id: u.id,
			username: u.username,
			email: u.email ?? '',
			role: u.admin ? t('admin.users.role.admin') : t('admin.users.role.user'),
			status,
			lastSeen: lastSeenLabel(u.lastSeenAt, now),
			self,
			avatarUrl: u.avatarUrl ?? null,
			actions
		};
	});
}

// No look-alike characters (0/O, 1/l/I) so the password survives being read out.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * generateTempPassword returns `length` characters from a 57-character alphabet
 * using unbiased rejection sampling over `crypto.getRandomValues`.
 */
export function generateTempPassword(
	length = 16,
	fill: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)
): string {
	const limit = 256 - (256 % ALPHABET.length);
	let out = '';
	while (out.length < length) {
		for (const byte of fill(new Uint8Array(length * 2))) {
			if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
		}
	}
	return out;
}
