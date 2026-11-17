// What the two-factor section shows, from the instance options and the
// account's own state. Pure; the components only render it.

import type { AuthOptions } from '$lib/api/account';
import { t } from '$lib/i18n';

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

export function totpUnavailableText(): string {
	return t('account.mfa.totpUnavailable');
}
export function emailUnavailableText(): string {
	return t('account.mfa.emailUnavailable');
}

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
		totpWhy: totp ? '' : options === null ? '' : totpUnavailableText(),
		email,
		emailWhy: email ? '' : emailUnavailableText()
	};
}

/** The one-line state of the account's two-factor setup. */
export function stateSentence(mfa: MfaState | undefined): string {
	if (!mfa || (!mfa.totp && !mfa.email)) return t('account.mfa.stateOff');
	if (mfa.totp && mfa.email) return t('account.mfa.stateBoth');
	return mfa.totp ? t('account.mfa.stateApp') : t('account.mfa.stateEmail');
}

/** A warning when few recovery codes remain, else null. */
export function recoveryWarning(mfa: MfaState | undefined): string | null {
	if (!mfa?.totp) return null;
	if (mfa.recoveryCodesLeft === 0) return t('account.mfa.noRecoveryLeft');
	if (mfa.recoveryCodesLeft <= 3) return t('account.mfa.fewRecoveryLeft', { count: mfa.recoveryCodesLeft });
	return null;
}

/** The secret as groups of four, easier to read aloud and to type. */
export function groupSecret(secret: string): string {
	return secret.replace(/(.{4})/g, '$1 ').trim();
}
