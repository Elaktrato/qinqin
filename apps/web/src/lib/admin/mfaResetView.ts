// Pure logic of the "Reset two-step sign-in" dialog in Settings, Admin, Users.
// The route (POST /api/admin/users/{id}/mfa/reset) removes the authenticator
// (also a pending setup), every recovery code and the email-code method,
// deletes every session and revokes every personal access token.

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

export function canSubmit(password: string, busy: boolean, needsCode: boolean, code: string): boolean {
	return !busy && password !== '' && (!needsCode || code.trim() !== '');
}

export const RESET_ERROR_FALLBACK = 'Could not reset the two-step sign-in. Try again.';

// Fixed sentences, never the server's message.
const TEXT: Record<string, string> = {
	wrong_password: 'Your password is wrong.',
	password_required: 'Enter your own password.',
	code_invalid: 'That code is not right. Use a current authenticator code or an unused recovery code.',
	not_found: 'This account does not exist any more.',
	self_target: 'You cannot reset your own two-step sign-in here. Use Settings, Account.',
	rate_limited: 'Too many tries. Wait a few minutes and try again.',
	busy: 'The server is busy. Try again in a moment.'
};

export function resetError(code: string | undefined): string {
	return (code && TEXT[code]) || RESET_ERROR_FALLBACK;
}

/** Which field takes focus after a refusal: the one to fix. */
export function focusAfterError(code: string | undefined): 'password' | 'code' {
	return code === 'code_invalid' ? 'code' : 'password';
}

export function resetNotice(username: string): string {
	return `Two-step sign-in of ${username} was reset; they were signed out everywhere.`;
}
