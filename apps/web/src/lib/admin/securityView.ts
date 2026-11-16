import type { AuditEvent, AuthSettings, EmailPolicy, Registration } from '$lib/api/adminSettings';

export const REGISTRATION_CHOICES: ReadonlyArray<{ value: Registration; label: string; hint: string }> = [
	{ value: 'closed', label: 'Closed', hint: 'Nobody can register; administrators create accounts. Invite links stop working.' },
	{ value: 'invite', label: 'By invite', hint: 'Only people with an invite link can register.' },
	{ value: 'open', label: 'Open', hint: 'Anyone who reaches this server can register. Invite links work too.' }
];

export const EMAIL_CHOICES: ReadonlyArray<{ value: EmailPolicy; label: string; hint: string }> = [
	{ value: 'off', label: 'Off', hint: 'No email addresses are collected or shown.' },
	{ value: 'optional', label: 'Optional', hint: 'People may add an address in their account settings.' },
	{ value: 'required', label: 'Required', hint: 'Registration and new accounts need an address; existing accounts are asked to add one.' }
];

export interface SwitchState {
	available: boolean;
	/** The sentence shown instead of the switch while it is unavailable. */
	reason: string;
}

export const NEEDS_EMAIL = 'Needs email: set up a mail server first.';

/** The two mail-dependent switches: hidden behind a sentence while mail is not configured. */
export function switchStates(s: Pick<AuthSettings, 'mail'>): { mfa: SwitchState; emailCode: SwitchState } {
	const ok = s.mail.configured;
	return {
		mfa: { available: ok, reason: ok ? '' : NEEDS_EMAIL },
		emailCode: { available: ok, reason: ok ? '' : NEEDS_EMAIL }
	};
}

const ACTION_TEXT: Record<string, string> = {
	user_created: 'created the account',
	user_deleted: 'deleted the account',
	account_deleted: 'deleted their own account',
	user_disabled: 'disabled the account',
	user_enabled: 'enabled the account',
	admin_granted: 'made an administrator',
	admin_revoked: 'removed as administrator',
	password_changed: 'changed their password',
	password_change_forced: 'must change the password',
	reset_link_issued: 'got a reset link',
	password_reset: 'reset their password',
	invite_created: 'created an invite',
	invite_revoked: 'revoked an invite',
	invite_used: 'registered with an invite',
	settings_changed: 'changed a setting',
	sessions_revoked: 'signed out sessions',
	data_exported: 'downloaded their data',
	data_restored: 'restored their data from a backup',
	server_backup_created: 'created a server backup'
};

/** One sentence per audit event: "alice: created the account bobby". */
export function auditLine(e: AuditEvent): string {
	const who = e.actor?.name || 'System';
	const what = ACTION_TEXT[e.action] ?? e.action.replaceAll('_', ' ');
	const target = e.target && e.target.id !== e.actor?.id ? ` (${e.target.name})` : '';
	const field = typeof e.detail?.field === 'string' ? `: ${e.detail.field}` : '';
	return `${who} ${what}${target}${field}`;
}
