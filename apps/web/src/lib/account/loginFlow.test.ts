import { describe, expect, it } from 'vitest';
import { firstMethod, hasSession, otherMethods, parseMfaChallenge, stepFor } from './loginFlow';

const body = { status: 'mfa_required', challenge: 'chal_example', methods: ['totp', 'recovery'], emailHint: null, expiresAt: '2026-11-15T12:10:00Z' };

describe('loginFlow', () => {
	it('maps the status words', () => {
		expect(stepFor('ok')).toEqual({ kind: 'done' });
		expect(stepFor('password_change_required')).toEqual({ kind: 'passwordChange' });
		expect(stepFor('mfa_enrollment_required')).toEqual({ kind: 'enrollment' });
	});
	it('reads an mfa_required body and nothing else as a challenge', () => {
		expect(stepFor('mfa_required', body)).toEqual({
			kind: 'mfa',
			mfa: { challenge: 'chal_example', methods: ['totp', 'recovery'], emailHint: null, expiresAt: '2026-11-15T12:10:00Z' }
		});
		expect(stepFor('mfa_required')).toEqual({ kind: 'credentials' });
		expect(stepFor('mfa_required', { ...body, challenge: '' })).toEqual({ kind: 'credentials' });
		expect(stepFor('mfa_required', { ...body, methods: ['carrier-pigeon'] })).toEqual({ kind: 'credentials' });
		expect(parseMfaChallenge(null)).toBeNull();
		expect(parseMfaChallenge({ ...body, methods: ['totp', 'x'] })?.methods).toEqual(['totp']);
	});
	it('never treats an unknown status as signed in', () => {
		expect(stepFor('something_new')).toEqual({ kind: 'credentials' });
		expect(hasSession(stepFor('something_new'))).toBe(false);
		expect(hasSession(stepFor('mfa_required', body))).toBe(false);
	});
	it('keeps a token for done, passwordChange and enrollment only', () => {
		expect(hasSession(stepFor('ok'))).toBe(true);
		expect(hasSession(stepFor('password_change_required'))).toBe(true);
		expect(hasSession(stepFor('mfa_enrollment_required'))).toBe(true);
	});
	it('starts with the authenticator and offers the others', () => {
		expect(firstMethod(['totp', 'recovery', 'email'])).toBe('totp');
		expect(firstMethod(['email'])).toBe('email');
		expect(otherMethods(['totp', 'recovery', 'email'], 'totp')).toEqual(['recovery', 'email']);
		expect(otherMethods(['totp', 'recovery'], 'recovery')).toEqual(['totp']);
		expect(otherMethods(['email'], 'email')).toEqual([]);
	});
});
