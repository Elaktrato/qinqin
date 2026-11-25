import type { AuditEvent, AuthSettings, EmailPolicy, Registration } from '$lib/api/adminSettings';
import { t, type MessageKey } from '$lib/i18n';

type Choice<V> = { value: V; readonly label: string; readonly hint: string };

function choice<V>(value: V, label: MessageKey, hint: MessageKey): Choice<V> {
	return {
		value,
		get label() {
			return t(label);
		},
		get hint() {
			return t(hint);
		}
	};
}

export const REGISTRATION_CHOICES: ReadonlyArray<Choice<Registration>> = [
	choice('closed', 'admin.security.registration.closed', 'admin.security.registration.closedHint'),
	choice('invite', 'admin.security.registration.invite', 'admin.security.registration.inviteHint'),
	choice('open', 'admin.security.registration.open', 'admin.security.registration.openHint')
];

export const EMAIL_CHOICES: ReadonlyArray<Choice<EmailPolicy>> = [
	choice('off', 'admin.security.email.off', 'admin.security.email.offHint'),
	choice('optional', 'admin.security.email.optional', 'admin.security.email.optionalHint'),
	choice('required', 'admin.security.email.required', 'admin.security.email.requiredHint')
];

export interface SwitchState {
	available: boolean;
	/** The sentence shown instead of the switch while it is unavailable. */
	reason: string;
}

export function needsEmail(): string {
	return t('admin.security.needsEmail');
}

/** The two mail-dependent switches: hidden behind a sentence while mail is not configured. */
export function switchStates(s: Pick<AuthSettings, 'mail'>): { mfa: SwitchState; emailCode: SwitchState } {
	const ok = s.mail.configured;
	return {
		mfa: { available: ok, reason: ok ? '' : needsEmail() },
		emailCode: { available: ok, reason: ok ? '' : needsEmail() }
	};
}

const ACTION_TEXT: Record<string, MessageKey> = {
	user_created: 'admin.audit.action.userCreated',
	user_deleted: 'admin.audit.action.userDeleted',
	account_deleted: 'admin.audit.action.accountDeleted',
	user_disabled: 'admin.audit.action.userDisabled',
	user_enabled: 'admin.audit.action.userEnabled',
	admin_granted: 'admin.audit.action.adminGranted',
	admin_revoked: 'admin.audit.action.adminRevoked',
	password_changed: 'admin.audit.action.passwordChanged',
	password_change_forced: 'admin.audit.action.passwordChangeForced',
	reset_link_issued: 'admin.audit.action.resetLinkIssued',
	password_reset: 'admin.audit.action.passwordReset',
	invite_created: 'admin.audit.action.inviteCreated',
	invite_revoked: 'admin.audit.action.inviteRevoked',
	invite_used: 'admin.audit.action.inviteUsed',
	settings_changed: 'admin.audit.action.settingsChanged',
	sessions_revoked: 'admin.audit.action.sessionsRevoked',
	mfa_reset: 'admin.audit.action.mfaReset',
	avatar_removed: 'admin.audit.action.avatarRemoved',
	data_exported: 'admin.audit.action.dataExported',
	data_restored: 'admin.audit.action.dataRestored',
	server_backup_created: 'admin.audit.action.serverBackupCreated'
};

/** One sentence per audit event: "alice: created the account bobby". */
export function auditLine(e: AuditEvent): string {
	const who = e.actor?.name || t('admin.audit.system');
	const what = Object.hasOwn(ACTION_TEXT, e.action) ? t(ACTION_TEXT[e.action]) : e.action.replaceAll('_', ' ');
	let line = t('admin.audit.line', { who, what });
	if (e.target && e.target.id !== e.actor?.id) line = t('admin.audit.withTarget', { line, target: e.target.name });
	if (typeof e.detail?.field === 'string') line = t('admin.audit.withField', { line, field: e.detail.field });
	return line;
}
