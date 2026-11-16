// What the two-factor section shows, from the instance options and the
// account's own state. Pure; the components only render it.

import type { AuthOptions } from '$lib/api/account';

export interface MfaState {
	totp: boolean;
	email: boolean;
	recoveryCodesLeft: number;
}

export interface TwoFactorChoices {
	/** Offer the authenticator app. */
	totp: boolean;
	/** Why it is hidden, when it is. */
	totpWhy: string;
	/** Offer emailed codes. */
	email: boolean;
	emailWhy: string;
}

export const TOTP_UNAVAILABLE_TEXT =
	'Authenticator apps need QINQIN_SECRET to be set on the server. Ask your administrator.';
export const EMAIL_UNAVAILABLE_TEXT = 'Emailed codes need email to be set up on this server.';

/**
 * mailAvailable: the server can send mail. `passwordReset` in the public
 * options is exactly that (it is false while no mail server is configured).
 */
export function mailAvailable(options: AuthOptions | null): boolean {
	return options?.passwordReset === true;
}

/** twoFactorChoices decides which methods a person may set up here. */
export function twoFactorChoices(options: AuthOptions | null): TwoFactorChoices {
	const totp = options?.totpAvailable !== false && options !== null;
	const email = mailAvailable(options) && options?.emailPolicy !== 'off';
	return {
		totp,
		totpWhy: totp ? '' : options === null ? '' : TOTP_UNAVAILABLE_TEXT,
		email,
		emailWhy: email ? '' : EMAIL_UNAVAILABLE_TEXT
	};
}

/** The one-line state of the account's two-factor setup. */
export function stateSentence(mfa: MfaState | undefined): string {
	if (!mfa || (!mfa.totp && !mfa.email)) return 'Two-step sign-in is off.';
	const parts: string[] = [];
	if (mfa.totp) parts.push('an authenticator app');
	if (mfa.email) parts.push('emailed codes');
	return `Two-step sign-in is on with ${parts.join(' and ')}.`;
}

/** A warning when few recovery codes remain, else null. */
export function recoveryWarning(mfa: MfaState | undefined): string | null {
	if (!mfa?.totp) return null;
	if (mfa.recoveryCodesLeft === 0) return 'You have no recovery codes left. Make new ones now.';
	if (mfa.recoveryCodesLeft <= 3) {
		return `Only ${mfa.recoveryCodesLeft} recovery ${mfa.recoveryCodesLeft === 1 ? 'code is' : 'codes are'} left. Consider making new ones.`;
	}
	return null;
}

/** The secret as groups of four, easier to read aloud and to type. */
export function groupSecret(secret: string): string {
	return secret.replace(/(.{4})/g, '$1 ').trim();
}
