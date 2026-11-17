// Pure logic of the "Reset two-step sign-in" dialog in Settings, Admin, Users.
// The route (POST /api/admin/users/{id}/mfa/reset) removes the authenticator
// (also a pending setup), every recovery code and the email-code method,
// deletes every session and revokes every personal access token.

import { t, type MessageKey } from '$lib/i18n';
import { reauthError } from './reauth';

export interface MfaFactors {
	totp: boolean;
	email: boolean;
}

/** Whether a listed user has a second step (servers before v0.3.0 send no mfa). */
export function hasSecondStep(u: { mfa?: MfaFactors }): boolean {
	return !!u.mfa && (u.mfa.totp || u.mfa.email);
}

/** What the reset removes and revokes, worded for the user's own factors. */
export function resetLines(mfa: MfaFactors): string[] {
	const lines: string[] = [];
	if (mfa.totp) lines.push(t('admin.mfaReset.line.totp'));
	if (mfa.email) lines.push(t('admin.mfaReset.line.email'));
	lines.push(t('admin.mfaReset.line.signedOut'), t('admin.mfaReset.line.next'));
	return lines;
}

export function resetErrorFallback(): string {
	return t('admin.mfaReset.error.fallback');
}

const TEXT: Record<string, MessageKey> = {
	not_found: 'admin.mfaReset.error.notFound',
	self_target: 'admin.mfaReset.error.selfTarget'
};

/** Fixed sentences, never the server's message (re-authentication ones from reauth.ts). */
export function resetError(code: string | undefined): string {
	return code && Object.hasOwn(TEXT, code) ? t(TEXT[code]) : reauthError(code, resetErrorFallback());
}

export function resetNotice(username: string): string {
	return t('admin.mfaReset.notice', { name: username });
}
