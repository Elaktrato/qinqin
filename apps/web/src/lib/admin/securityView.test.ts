import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '$lib/api/adminSettings';
import { EMAIL_CHOICES, needsEmail, REGISTRATION_CHOICES, auditLine, switchStates } from './securityView';

describe('security view', () => {
	it('has a sentence per registration mode and email policy', () => {
		expect(REGISTRATION_CHOICES.map((c) => c.value)).toEqual(['closed', 'invite', 'open']);
		expect(EMAIL_CHOICES.map((c) => c.value)).toEqual(['off', 'optional', 'required']);
		expect([...REGISTRATION_CHOICES, ...EMAIL_CHOICES].every((c) => c.hint.length > 10)).toBe(true);
	});
	it('hides the mail switches with the needs-email sentence while mail is unconfigured', () => {
		const off = switchStates({ mail: { configured: false } });
		expect(off.mfa).toEqual({ available: false, reason: needsEmail() });
		expect(off.emailCode.available).toBe(false);
		expect(switchStates({ mail: { configured: true } }).mfa.available).toBe(true);
	});
	it('words an audit line', () => {
		const e = (o: Partial<AuditEvent>): AuditEvent => ({ id: 1, at: 't', action: 'user_created', actor: { id: 1, name: 'alice' }, target: { id: 2, name: 'bobby' }, detail: {}, ...o });
		expect(auditLine(e({}))).toBe('alice created the account (bobby)');
		expect(auditLine(e({ actor: null, action: 'settings_changed', target: null, detail: { field: 'registration' } }))).toBe('System changed a setting: registration');
		expect(auditLine(e({ action: 'password_changed', target: { id: 1, name: 'alice' } }))).toBe('alice changed their password');
		expect(auditLine(e({ action: 'mfa_reset' }))).toBe('alice reset the two-step sign-in (bobby)');
		expect(auditLine(e({ action: 'avatar_removed' }))).toBe('alice removed the profile picture (bobby)');
		expect(auditLine(e({ action: 'something_new' }))).toContain('something new');
	});
});
