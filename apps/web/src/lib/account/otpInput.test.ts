import { describe, expect, it } from 'vitest';
import { attemptsText, codeFailure, otpAttrs, otpComplete, resendText, sanitizeOtp } from './otpInput';
import { apiErrorText } from '$lib/api/apiErrors';

describe('otpInput', () => {
	it('sets the attributes password managers and phones look for', () => {
		expect(otpAttrs('totp')).toMatchObject({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
		expect(otpAttrs('email')).toMatchObject({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
		expect(otpAttrs('recovery')).toMatchObject({ inputmode: 'text', autocomplete: 'off' });
	});
	it('strips pasted spaces and punctuation from a six-digit code', () => {
		expect(sanitizeOtp('123 456', 'totp')).toBe('123456');
		expect(sanitizeOtp(' 12-34-56 ', 'email')).toBe('123456');
		expect(sanitizeOtp('1234567890', 'totp')).toBe('123456');
		expect(sanitizeOtp('abc', 'totp')).toBe('');
	});
	it('keeps a recovery code readable', () => {
		expect(sanitizeOtp('abcd efgh-ijkl mnop', 'recovery')).toBe('ABCDEFGH-IJKLMNOP');
		expect(sanitizeOtp('ab!cd', 'recovery')).toBe('ABCD');
	});
	it('knows when a code can be submitted', () => {
		expect(otpComplete('123456', 'totp')).toBe(true);
		expect(otpComplete('12345', 'totp')).toBe(false);
		expect(otpComplete('ABCD-EFGH-IJKL-MNOP', 'recovery')).toBe(true);
		expect(otpComplete('ABCD-EFGH', 'recovery')).toBe(false);
	});
	it('words the attempts and the countdown', () => {
		expect(attemptsText(1)).toBe('1 attempt left');
		expect(attemptsText(3)).toBe('3 attempts left');
		expect(resendText(60)).toBe('You can ask for a new code in 60 seconds.');
		expect(resendText(1)).toBe('You can ask for a new code in 1 second.');
		expect(resendText(0)).toBe('You can ask for a new code now.');
	});
	it('puts the attempts in the error and sends an expired challenge back to step one', () => {
		expect(codeFailure({ error: 'code_invalid', attemptsLeft: 3 }, 'f')).toEqual({ text: 'That code is not right. 3 attempts left.', restart: false });
		expect(codeFailure({ error: 'code_invalid' }, 'f').text).toBe('That code is not right.');
		const gone = codeFailure({ error: 'challenge_expired' }, 'f');
		expect(gone.restart).toBe(true);
		expect(gone.text).toContain('Enter your details again');
		expect(codeFailure({ error: 'rate_limited' }, 'f').text).toBe(apiErrorText('rate_limited'));
		expect(codeFailure({ error: 'brand_new' }, 'f').text).toBe('f');
		expect(codeFailure(null, 'Could not check the code.').text).toBe('Could not check the code.');
	});
});
