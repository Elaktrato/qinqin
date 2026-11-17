import { describe, expect, it } from 'vitest';
import errors from '../../../../../docs/contracts/auth/errors.json';
import { reauthErrorFallback, reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';

describe('reauthNeedsCode', () => {
	it('asks for a code when the administrator has an authenticator, or after the server asked for one', () => {
		expect(reauthNeedsCode(true, false)).toBe(true);
		expect(reauthNeedsCode(false, false)).toBe(false);
		expect(reauthNeedsCode(undefined, false)).toBe(false);
		// a stale copy of "me" (authenticator added in another tab) can still finish
		expect(reauthNeedsCode(false, true)).toBe(true);
	});
});

describe('reauthReady', () => {
	it('needs the password, and the code when one is asked for', () => {
		expect(reauthReady('', false, '')).toBe(false);
		expect(reauthReady('pw', false, '')).toBe(true);
		expect(reauthReady('pw', true, ' ')).toBe(false);
		expect(reauthReady('pw', true, '123456')).toBe(true);
	});
});

describe('reauthBody', () => {
	it('sends the password, and the trimmed code only when one is asked for', () => {
		expect(reauthBody('pw', false, '123456')).toEqual({ currentPassword: 'pw' });
		expect(reauthBody('pw', true, ' 123456 ')).toEqual({ currentPassword: 'pw', code: '123456' });
		expect(reauthBody('pw', true, '')).toEqual({ currentPassword: 'pw' });
	});
});

describe('reauthError', () => {
	it('words the re-authentication refusals with fixed sentences', () => {
		expect(reauthError('wrong_password')).toBe('Your password is wrong.');
		expect(reauthError('password_required')).toBe('Enter your own password.');
		expect(reauthError('code_invalid')).toBe('That code is not right. Use a current authenticator code or an unused recovery code.');
		expect(reauthError('rate_limited')).toContain('Too many tries');
		expect(reauthError('busy')).toContain('busy');
		expect(reauthError('something_new')).toBe(reauthErrorFallback());
		expect(reauthError(undefined, 'Could not delete the account.')).toBe('Could not delete the account.');
		for (const code of ['wrong_password', 'password_required', 'code_invalid', 'rate_limited', 'busy']) {
			expect(Object.keys(errors)).toContain(code);
		}
	});
});

describe('reauthFocus', () => {
	it('sends focus to the field to fix and says which to clear', () => {
		expect(reauthFocus('code_invalid')).toEqual({ focus: 'code', clear: 'code' });
		expect(reauthFocus('wrong_password')).toEqual({ focus: 'password', clear: 'password' });
		expect(reauthFocus('busy')).toEqual({ focus: 'password', clear: null });
	});
});
