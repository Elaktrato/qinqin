import { describe, expect, it } from 'vitest';
import {
	MAX_PASSWORD,
	MIN_PASSWORD,
	passwordHint,
	passwordProblem,
	confirmProblem
} from './passwordRules';

describe('passwordProblem (mirror of the server policy)', () => {
	it('exports the bounds', () => {
		expect([MIN_PASSWORD, MAX_PASSWORD]).toEqual([10, 256]);
		expect(passwordHint()).toBe('At least 10 characters. No other rules.');
	});

	it.each([
		['123456789', 'alice', 'Use at least 10 characters.'],
		['', 'alice', 'Use at least 10 characters.'],
		['x'.repeat(257), 'alice', 'Use at most 256 characters.'],
		['Alice-Wonder', 'alice-wonder', 'The password must differ from the username.']
	])('rejects %j for %s', (pw, user, message) => {
		expect(passwordProblem(user, pw)).toBe(message);
	});

	it.each([
		['1234567890', 'alice'],
		['x'.repeat(256), 'alice'],
		['ääääääääää', 'alice'],
		['alice-is-here-1', 'alice'],
		['😀😀😀😀😀😀😀😀😀😀', 'alice']
	])('accepts %j', (pw, user) => {
		expect(passwordProblem(user, pw)).toBeNull();
	});

	it('counts characters, not UTF-16 units', () => {
		expect(passwordProblem('u', '😀'.repeat(9))).toBe('Use at least 10 characters.');
	});
});

describe('confirmProblem', () => {
	it('is silent until the confirmation is typed', () => {
		expect(confirmProblem('a-long-password', '')).toBeNull();
	});
	it('names a mismatch', () => {
		expect(confirmProblem('a-long-password', 'a-long-passwor')).toBe(
			'The two passwords do not match.'
		);
	});
	it('accepts a match', () => {
		expect(confirmProblem('a-long-password', 'a-long-password')).toBeNull();
	});
});
