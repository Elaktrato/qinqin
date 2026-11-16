import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/auth/admin-users.json';
import errors from '../../../../../docs/contracts/auth/errors.json';
import type { AdminUserDto } from '$lib/api/adminUsers';
import { hasSecondStep, resetError, resetLines, resetNotice, RESET_ERROR_FALLBACK } from './mfaResetView';

describe('resetLines', () => {
	it('names the authenticator and its recovery codes only when the user has one', () => {
		const lines = resetLines({ totp: true, email: false });
		expect(lines[0]).toBe('Their authenticator app and all of its recovery codes are removed.');
		expect(lines.join(' ')).not.toContain('email');
	});
	it('names the emailed codes only when the user has them', () => {
		const lines = resetLines({ totp: false, email: true });
		expect(lines[0]).toBe('Sign-in codes by email are turned off.');
		expect(lines.join(' ')).not.toContain('authenticator');
	});
	it('always says that sessions end and access tokens are revoked, and what happens next', () => {
		for (const mfa of [{ totp: true, email: true }, { totp: false, email: false }]) {
			const text = resetLines(mfa).join(' ');
			expect(text).toContain('signed out on every device');
			expect(text).toContain('personal access tokens are revoked');
			expect(text).toContain('password alone');
		}
		expect(resetLines({ totp: true, email: true })).toHaveLength(4);
	});
});

describe('hasSecondStep', () => {
	it('is true for an authenticator or emailed codes, false when the list has no mfa member', () => {
		expect(hasSecondStep({ mfa: { totp: true, email: false } })).toBe(true);
		expect(hasSecondStep({ mfa: { totp: false, email: true } })).toBe(true);
		expect(hasSecondStep({ mfa: { totp: false, email: false } })).toBe(false);
		expect(hasSecondStep({})).toBe(false);
	});
});

describe('resetError', () => {
	it('maps each server code to a fixed sentence', () => {
		expect(resetError('wrong_password')).toBe('Your password is wrong.');
		expect(resetError('password_required')).toBe('Enter your own password.');
		expect(resetError('code_invalid')).toBe('That code is not right. Use a current authenticator code or an unused recovery code.');
		expect(resetError('not_found')).toBe('This account does not exist any more.');
		expect(resetError('self_target')).toContain('Settings, Account');
		expect(resetError('rate_limited')).toContain('Too many tries');
		expect(resetError('busy')).toContain('busy');
	});
	it('falls back to one generic sentence for anything else, never a server message', () => {
		expect(resetError(undefined)).toBe(RESET_ERROR_FALLBACK);
		expect(resetError('something_new')).toBe(RESET_ERROR_FALLBACK);
	});
	it('only maps codes the server documents', () => {
		for (const code of ['wrong_password', 'password_required', 'code_invalid', 'not_found', 'self_target', 'rate_limited', 'busy']) {
			expect(Object.keys(errors)).toContain(code);
		}
	});
});

describe('resetNotice', () => {
	it('says what happened', () => {
		expect(resetNotice('bobby')).toBe('Two-step sign-in of bobby was reset; they were signed out everywhere.');
	});
});

describe('docs/contracts/auth/admin-users.json', () => {
	it('lists users with which second steps they have, and the reset request', () => {
		const listed = fixture.list.body.users[0] as AdminUserDto;
		expect(listed.mfa).toEqual({ totp: false, email: false });
		expect(hasSecondStep(listed)).toBe(false);
		expect(fixture.mfa_reset.request).toMatchObject({ method: 'POST', path: '/api/admin/users/{id}/mfa/reset' });
		expect(Object.keys(fixture.mfa_reset.request.body).sort()).toEqual(['code', 'currentPassword']);
		expect(fixture.mfa_reset.status).toBe(204);
	});
});
