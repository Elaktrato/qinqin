// The one-time-code field of the sign-in steps: what to strip, what
// attributes to set, and the sentences for a refused code. Pure.

import type { MfaMethod } from './loginFlow';

export interface OtpAttrs {
	inputmode: 'numeric' | 'text';
	autocomplete: 'one-time-code' | 'off';
	maxlength: number;
	label: string;
}

/** The field attributes of a method (the authenticator and email codes are 6 digits). */
export function otpAttrs(method: MfaMethod): OtpAttrs {
	if (method === 'recovery') return { inputmode: 'text', autocomplete: 'off', maxlength: 24, label: 'Recovery code' };
	return {
		inputmode: 'numeric',
		autocomplete: 'one-time-code',
		maxlength: 6,
		label: method === 'email' ? 'Code from the email' : 'Code from your authenticator app'
	};
}

/**
 * sanitizeOtp cleans what was typed or pasted: a six-digit code loses
 * everything but digits (a pasted "123 456" works) and is cut to six; a
 * recovery code loses spaces and keeps letters, digits and dashes.
 */
export function sanitizeOtp(raw: string, method: MfaMethod): string {
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
	return n === 1 ? '1 attempt left' : `${n} attempts left`;
}

/** The seconds on a resend countdown, as the text the page announces. */
export function resendText(secondsLeft: number): string {
	if (secondsLeft <= 0) return 'You can ask for a new code now.';
	return `You can ask for a new code in ${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'}.`;
}

export interface CodeFailure {
	/** The sentence to show. */
	text: string;
	/** True when the challenge is gone: go back to the first step. */
	restart: boolean;
}

export const CHALLENGE_EXPIRED_TEXT =
	'That sign-in took too long or had too many wrong codes. Enter your details again to get a new one.';

/** codeFailure words a refused code from the server's error body. */
export function codeFailure(body: { error: string; message: string; attemptsLeft?: number } | null, fallback: string): CodeFailure {
	if (!body) return { text: fallback, restart: false };
	if (body.error === 'challenge_expired') return { text: CHALLENGE_EXPIRED_TEXT, restart: true };
	if (body.error === 'code_invalid') {
		const left = typeof body.attemptsLeft === 'number' ? ` ${attemptsText(body.attemptsLeft)}.` : '';
		return { text: `That code is not right.${left}`, restart: false };
	}
	return { text: body.message || fallback, restart: false };
}
