import type { AdminUserDto } from '$lib/api/adminUsers';
import { hasSecondStep } from './mfaResetView';

/** Actions that ask the acting administrator for their own password (and code, with an authenticator) first. */
export const NEEDS_PASSWORD: ReadonlySet<UserActionId> = new Set(['makeAdmin', 'resetLink', 'delete']);

export const LAST_ADMIN_REASON = 'The last administrator cannot be removed.';

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
	role: 'Administrator' | 'User';
	/** Text badges, never colour alone. */
	status: string[];
	lastSeen: string;
	self: boolean;
	actions: UserAction[];
}

/** "Never", "Just now", "5 minutes ago", ... from an injected now. */
export function lastSeenLabel(iso: string | null, now: Date): string {
	if (!iso) return 'Never';
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return 'Never';
	const minutes = Math.floor((now.getTime() - then) / 60000);
	if (minutes < 1) return 'Just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
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
		const guard = (id: UserActionId, label: string): UserAction => ({
			id,
			label,
			disabled: lastAdmin,
			...(lastAdmin ? { reason: LAST_ADMIN_REASON } : {})
		});
		const actions: UserAction[] = [
			u.admin ? guard('removeAdmin', 'Remove admin') : { id: 'makeAdmin', label: 'Make admin', disabled: false }
		];
		if (!self) actions.push(u.disabled ? { id: 'enable', label: 'Enable', disabled: false } : guard('disable', 'Disable'));
		actions.push(
			{ id: 'requirePasswordChange', label: 'Require password change', disabled: false },
			{ id: 'resetLink', label: 'Reset link', disabled: false },
			{ id: 'revokeResetLink', label: 'Revoke reset link', disabled: false },
			{ id: 'signOutEverywhere', label: 'Sign out everywhere', disabled: false }
		);
		// Not for oneself: Settings, Account manages one's own factors (the server answers self_target).
		if (!self && hasSecondStep(u)) actions.push({ id: 'resetMfa', label: 'Reset two-step sign-in', disabled: false });
		if (!self) actions.push(guard('delete', 'Delete'));
		const status = [u.disabled ? 'Disabled' : 'Active'];
		if (u.mustChangePassword) status.push('Must change password');
		return {
			id: u.id,
			username: u.username,
			email: u.email ?? '',
			role: u.admin ? 'Administrator' : 'User',
			status,
			lastSeen: lastSeenLabel(u.lastSeenAt, now),
			self,
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
