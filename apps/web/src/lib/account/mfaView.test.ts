import { describe, expect, it } from 'vitest';
import type { AuthOptions } from '$lib/api/account';
import { EMAIL_UNAVAILABLE_TEXT, TOTP_UNAVAILABLE_TEXT, groupSecret, mailAvailable, recoveryWarning, stateSentence, twoFactorChoices } from './mfaView';

const base: AuthOptions = {
	bootstrap: false,
	registration: 'closed',
	emailPolicy: 'optional',
	passwordReset: true,
	emailCodeLogin: false,
	passwordMinLength: 10,
	totpAvailable: true,
	mfaEnforced: false
};

describe('mfaView', () => {
	it('offers both methods when the secret is valid and mail works', () => {
		expect(twoFactorChoices(base)).toEqual({ totp: true, totpWhy: '', email: true, emailWhy: '' });
	});
	it('hides the authenticator with the secret sentence', () => {
		const c = twoFactorChoices({ ...base, totpAvailable: false });
		expect(c.totp).toBe(false);
		expect(c.totpWhy).toBe(TOTP_UNAVAILABLE_TEXT);
	});
	it('hides emailed codes without mail or without addresses', () => {
		expect(twoFactorChoices({ ...base, passwordReset: false })).toMatchObject({ email: false, emailWhy: EMAIL_UNAVAILABLE_TEXT });
		expect(twoFactorChoices({ ...base, emailPolicy: 'off' }).email).toBe(false);
		expect(mailAvailable(null)).toBe(false);
	});
	it('waits for the options before offering anything', () => {
		expect(twoFactorChoices(null).totp).toBe(false);
		expect(twoFactorChoices(null).totpWhy).toBe('');
	});
	it('words the state and the recovery warning', () => {
		expect(stateSentence(undefined)).toBe('Two-step sign-in is off.');
		expect(stateSentence({ totp: true, email: false, recoveryCodesLeft: 10 })).toBe('Two-step sign-in is on with an authenticator app.');
		expect(stateSentence({ totp: true, email: true, recoveryCodesLeft: 10 })).toBe('Two-step sign-in is on with an authenticator app and emailed codes.');
		expect(recoveryWarning({ totp: true, email: false, recoveryCodesLeft: 10 })).toBeNull();
		expect(recoveryWarning({ totp: true, email: false, recoveryCodesLeft: 1 })).toContain('Only 1 recovery code is left');
		expect(recoveryWarning({ totp: true, email: false, recoveryCodesLeft: 0 })).toContain('no recovery codes');
		expect(recoveryWarning({ totp: false, email: true, recoveryCodesLeft: 0 })).toBeNull();
	});
	it('groups the secret by four', () => {
		expect(groupSecret('ABCDEFGHIJKL')).toBe('ABCD EFGH IJKL');
	});
});
