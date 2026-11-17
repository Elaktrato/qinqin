// The mail server form: draft <-> payload, the password tri-state, port
// defaults and the sentences for a failed test mail. Pure.

import type { SmtpPayload, SmtpSettings } from '$lib/api/adminSettings';
import { t, type MessageKey } from '$lib/i18n';

export type TlsMode = 'starttls' | 'tls' | 'none';
export type PasswordChoice = 'keep' | 'replace' | 'remove';

export interface SmtpDraft {
	host: string;
	port: number;
	tls: TlsMode;
	username: string;
	password: string;
	passwordChoice: PasswordChoice;
	fromAddress: string;
	fromName: string;
	publicUrl: string;
}

export const PORT_DEFAULTS: Record<TlsMode, number> = { starttls: 587, tls: 465, none: 25 };
export function plainWarning(): string {
	return t('admin.email.plainWarning');
}

/** The port to use when the mode changes: a default is replaced, a custom port is kept. */
export function portForMode(current: number, from: TlsMode, to: TlsMode): number {
	return current === PORT_DEFAULTS[from] ? PORT_DEFAULTS[to] : current;
}

export function draftFrom(s: SmtpSettings): SmtpDraft {
	return {
		host: s.host,
		port: s.port,
		tls: s.tls,
		username: s.username,
		password: '',
		passwordChoice: 'keep',
		fromAddress: s.fromAddress,
		fromName: s.fromName,
		publicUrl: s.publicUrl
	};
}

/**
 * payloadFrom builds the PUT/test body. The saved password is never
 * prefilled: keep sends no password key, remove sends "", replace sends the
 * typed one (an empty typed password counts as keep).
 */
export function payloadFrom(d: SmtpDraft): SmtpPayload {
	const body: SmtpPayload = {
		host: d.host.trim(),
		port: d.port,
		tls: d.tls,
		username: d.username.trim(),
		fromAddress: d.fromAddress.trim(),
		fromName: d.fromName.trim(),
		publicUrl: d.publicUrl.trim()
	};
	if (d.passwordChoice === 'remove') body.password = '';
	else if (d.passwordChoice === 'replace' && d.password !== '') body.password = d.password;
	return body;
}

/** The sentence beside the password field. */
export function passwordNote(state: SmtpSettings['password']): string {
	if (state === 'set') return t('admin.email.password.set');
	if (state === 'undecryptable') return t('admin.email.password.undecryptable');
	return t('admin.email.password.none');
}

/** A connection or public-URL change needs the password again (the server enforces it). */
export function needsReentry(saved: SmtpSettings, d: SmtpDraft): boolean {
	return saved.password !== 'none' && d.passwordChoice === 'keep' &&
		(saved.host !== d.host.trim() || saved.port !== d.port || saved.tls !== d.tls || saved.username !== d.username.trim() ||
			saved.publicUrl !== d.publicUrl.trim());
}

const CATEGORY_TEXT: Record<string, MessageKey> = {
	connect: 'admin.email.failure.connect',
	blocked: 'admin.email.failure.blocked',
	tls: 'admin.email.failure.tls',
	auth: 'admin.email.failure.auth',
	sender: 'admin.email.failure.sender',
	recipient: 'admin.email.failure.recipient',
	timeout: 'admin.email.failure.timeout',
	protocol: 'admin.email.failure.protocol'
};

/** testFailure words a failed test mail from its category and reply code. */
export function testFailure(category: string, smtpCode?: number): string {
	const text = Object.hasOwn(CATEGORY_TEXT, category) ? t(CATEGORY_TEXT[category]) : t('admin.email.failure.other');
	return smtpCode ? t('admin.email.failure.withCode', { text, code: smtpCode }) : text;
}
