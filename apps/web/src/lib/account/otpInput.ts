// The one-time-code field of the sign-in steps: what to strip, what
// attributes to set, and the sentences for a refused code. Pure.

import { API_ERROR_KEYS, apiErrorText } from '$lib/api/apiErrors';
import { t } from '$lib/i18n';
import type { MfaMethod } from './loginFlow';

export interface OtpAttrs {
	inputmode: 'numeric' | 'text';
	autocomplete: 'one-time-code' | 'off';
	maxlength: number;
	label: string;
}

/** The field attributes of a method (the authenticator and email codes are 6 digits). */
export function otpAttrs(method: MfaMethod): OtpAttrs {
	if (method === 'recovery') return { inputmode: 'text', autocomplete: 'off', maxlength: 24, label: t('account.otp.recoveryCode') };
	return {
		inputmode: 'numeric',
		autocomplete: 'one-time-code',
		maxlength: 6,
		label: method === 'email' ? t('account.otp.emailCode') : t('account.otp.appCode')
	};
}

/**
 * sanitizeOtp cleans what was typed or pasted: a six-digit code loses
 * everything but digits (a pasted "123 456" works) and is cut to six; a
 * recovery code loses spaces and keeps letters, digits and dashes.
 */
export function sanitizeOtp(raw: string, method: MfaMethod): string {
	// NFKC folds full-width digits and letters an IME types (１２３ -> 123).
	raw = raw.normalize('NFKC');
	if (method === 'recovery') return raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 19);
	return raw.replace(/\D/g, '').slice(0, 6);
}

/** True when the code is long enough to submit. */
export function otpComplete(code: string, method: MfaMethod): boolean {
	if (method === 'recovery') return code.replace(/-/g, '').length === 16;
	return /^\d{6}$/.test(code);
}

/** "3 attempts left", "1 attempt left". */
export function attemptsText(n: number): string {
	return t('account.otp.attemptsLeft', { count: n });
}

/** The seconds on a resend countdown, as the text the page announces. */
export function resendText(secondsLeft: number): string {
	if (secondsLeft <= 0) return t('account.otp.resendNow');
	return t('account.otp.resendIn', { count: secondsLeft });
}

export interface CodeFailure {
	/** The sentence to show. */
	text: string;
	/** True when the challenge is gone: go back to the first step. */
	restart: boolean;
}

export function challengeExpiredText(): string {
	return t('account.otp.challengeExpired');
}

/** codeFailure words a refused code from the server's error body. */
export function codeFailure(body: { error: string; attemptsLeft?: number } | null, fallback: string): CodeFailure {
	if (!body) return { text: fallback, restart: false };
	if (body.error === 'challenge_expired') return { text: challengeExpiredText(), restart: true };
	if (body.error === 'code_invalid') {
		const text =
			typeof body.attemptsLeft === 'number'
				? t('account.otp.codeWrongLeft', { left: attemptsText(body.attemptsLeft) })
				: t('account.otp.codeWrong');
		return { text, restart: false };
	}
	return { text: Object.hasOwn(API_ERROR_KEYS, body.error) ? apiErrorText(body.error) : fallback, restart: false };
}

/**
 * reconcileOtp is the input handler body: it returns the value to keep and
 * writes the cleaned text back into the field, except while an IME
 * composition is open (rewriting would destroy the composition string); the
 * compositionend handler calls it again with composing false.
 */
export function reconcileOtp(el: HTMLInputElement, method: MfaMethod, composing: boolean): string {
	if (composing) return el.value;
	const code = sanitizeOtp(el.value, method);
	el.value = code;
	return code;
}
