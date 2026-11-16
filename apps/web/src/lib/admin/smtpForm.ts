// The mail server form: draft <-> payload, the password tri-state, port
// defaults and the sentences for a failed test mail. Pure.

import type { SmtpPayload, SmtpSettings } from '$lib/api/adminSettings';

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
export const PLAIN_WARNING = 'Mail is sent without encryption. Use this only on a private network, never with a password.';

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
	if (state === 'set') return 'A password is saved.';
	if (state === 'undecryptable') return 'The saved password cannot be read any more: enter it again.';
	return 'No password is saved.';
}

/** A connection or public-URL change needs the password again (the server enforces it). */
export function needsReentry(saved: SmtpSettings, d: SmtpDraft): boolean {
	return saved.password !== 'none' && d.passwordChoice === 'keep' &&
		(saved.host !== d.host.trim() || saved.port !== d.port || saved.tls !== d.tls || saved.username !== d.username.trim() ||
			saved.publicUrl !== d.publicUrl.trim());
}

const CATEGORY_TEXT: Record<string, string> = {
	connect: 'The server could not be reached. Check the host name and port.',
	blocked: 'This address is not allowed. Private networks need QINQIN_SMTP_ALLOW_PRIVATE on the server.',
	tls: 'The secure connection failed. Check the connection security setting and the server certificate.',
	auth: 'The server refused the user name or password.',
	sender: 'The server refused the sender address.',
	recipient: 'The server refused the recipient address.',
	timeout: 'The server did not answer in time.',
	protocol: 'The server answered in a way qinqin does not understand.'
};

/** testFailure words a failed test mail from its category and reply code. */
export function testFailure(category: string, smtpCode?: number): string {
	const text = CATEGORY_TEXT[category] ?? 'The test mail could not be sent.';
	return smtpCode ? `${text} (server reply ${smtpCode})` : text;
}
