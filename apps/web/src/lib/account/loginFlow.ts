// The sign-in steps as one small state machine, so the login page, the
// reset page and the two-factor and email-code steps share it.

export type MfaMethod = 'totp' | 'recovery' | 'email';

/** What `mfa_required` hands the client: a challenge to answer, never a session. */
export interface MfaChallenge {
	challenge: string;
	methods: MfaMethod[];
	/** A masked address such as `a•••@e•••.org`, when the email method is offered. */
	emailHint: string | null;
	expiresAt: string;
}

export type LoginStep =
	| { kind: 'credentials' }
	| { kind: 'done' }
	| { kind: 'passwordChange' }
	/** Signed in with a restricted session that must enrol a second factor. */
	| { kind: 'enrollment' }
	| { kind: 'mfa'; mfa: MfaChallenge };

const METHODS: readonly MfaMethod[] = ['totp', 'recovery', 'email'];

/** parseMfaChallenge reads an `mfa_required` body; null when it is not one. */
export function parseMfaChallenge(body: unknown): MfaChallenge | null {
	if (typeof body !== 'object' || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.challenge !== 'string' || b.challenge === '' || !Array.isArray(b.methods)) return null;
	const methods = b.methods.filter((m): m is MfaMethod => (METHODS as readonly unknown[]).includes(m));
	if (methods.length === 0) return null;
	return {
		challenge: b.challenge,
		methods,
		emailHint: typeof b.emailHint === 'string' ? b.emailHint : null,
		expiresAt: typeof b.expiresAt === 'string' ? b.expiresAt : ''
	};
}

/**
 * stepFor maps the `status` word of a login-shaped response (and, for
 * `mfa_required`, its body) to the next step. `ok` is signed in;
 * `password_change_required` and `mfa_enrollment_required` are signed-in,
 * restricted sessions; `mfa_required` is a challenge and no session. A status
 * this client does not know stays on credentials, so an old client never
 * treats it as signed in.
 */
export function stepFor(status: string, body?: unknown): LoginStep {
	switch (status) {
		case 'ok':
			return { kind: 'done' };
		case 'password_change_required':
			return { kind: 'passwordChange' };
		case 'mfa_enrollment_required':
			return { kind: 'enrollment' };
		case 'mfa_required': {
			const mfa = parseMfaChallenge(body);
			return mfa ? { kind: 'mfa', mfa } : { kind: 'credentials' };
		}
		default:
			return { kind: 'credentials' };
	}
}

/** True for the steps that leave the sign-in page with a stored token. */
export function hasSession(step: LoginStep): boolean {
	return step.kind === 'done' || step.kind === 'passwordChange' || step.kind === 'enrollment';
}

/** The method the second step starts with: the authenticator, else email. */
export function firstMethod(methods: readonly MfaMethod[]): MfaMethod {
	if (methods.includes('totp')) return 'totp';
	if (methods.includes('email')) return 'email';
	return methods[0] ?? 'totp';
}

/** The other methods the person may switch to, in the order the page lists them. */
export function otherMethods(methods: readonly MfaMethod[], current: MfaMethod): MfaMethod[] {
	return (['totp', 'recovery', 'email'] as const).filter((m) => m !== current && methods.includes(m));
}
