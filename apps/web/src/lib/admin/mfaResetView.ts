// Pure logic of the "Reset two-step sign-in" dialog in Settings, Admin, Users.
// The route (POST /api/admin/users/{id}/mfa/reset) removes the authenticator
// (also a pending setup), every recovery code and the email-code method,
// deletes every session and revokes every personal access token.

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
	if (mfa.totp) lines.push('Their authenticator app and all of its recovery codes are removed.');
	if (mfa.email) lines.push('Sign-in codes by email are turned off.');
	lines.push(
		'They are signed out on every device, and all of their personal access tokens are revoked.',
		'Next time they sign in with their password alone, or set up a second step again if this server requires one. Do this only after making sure the request really comes from them.'
	);
	return lines;
}

export const RESET_ERROR_FALLBACK = 'Could not reset the two-step sign-in. Try again.';

const TEXT: Record<string, string> = {
	not_found: 'This account does not exist any more.',
	self_target: 'You cannot reset your own two-step sign-in here. Use Settings, Account.'
};

/** Fixed sentences, never the server's message (re-authentication ones from reauth.ts). */
export function resetError(code: string | undefined): string {
	return (code && TEXT[code]) || reauthError(code, RESET_ERROR_FALLBACK);
}

export function resetNotice(username: string): string {
	return `Two-step sign-in of ${username} was reset; they were signed out everywhere.`;
}
