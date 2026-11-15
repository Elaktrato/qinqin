// The sign-in steps as one small state machine, so the login page, the
// reset page and (plan 3) the two-factor and email-code steps share it.

export type LoginStep =
	| { kind: 'credentials' }
	| { kind: 'done' }
	| { kind: 'passwordChange' };

/**
 * stepFor maps the `status` word of a login-shaped response to the next
 * step. `ok` is signed in; `password_change_required` is a signed-in
 * session that must change the password first. A status this client does
 * not know (plan 3 adds `mfa_required` and others) stays on credentials, so
 * an old client never treats it as signed in.
 */
export function stepFor(status: string): LoginStep {
	switch (status) {
		case 'ok':
			return { kind: 'done' };
		case 'password_change_required':
			return { kind: 'passwordChange' };
		default:
			return { kind: 'credentials' };
	}
}

/** True for the steps that leave the sign-in page with a stored token. */
export function hasSession(step: LoginStep): boolean {
	return step.kind === 'done' || step.kind === 'passwordChange';
}
