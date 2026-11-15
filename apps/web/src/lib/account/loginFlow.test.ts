import { describe, expect, it } from 'vitest';
import { hasSession, stepFor } from './loginFlow';

describe('loginFlow', () => {
	it('maps the status words', () => {
		expect(stepFor('ok')).toEqual({ kind: 'done' });
		expect(stepFor('password_change_required')).toEqual({ kind: 'passwordChange' });
	});
	it('does not treat an unknown status as signed in', () => {
		expect(stepFor('mfa_required')).toEqual({ kind: 'credentials' });
		expect(hasSession(stepFor('mfa_required'))).toBe(false);
	});
	it('keeps a token for done and passwordChange only', () => {
		expect(hasSession(stepFor('ok'))).toBe(true);
		expect(hasSession(stepFor('password_change_required'))).toBe(true);
	});
});
