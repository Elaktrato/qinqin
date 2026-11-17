// Re-authentication of the acting administrator before a destructive admin
// action (grant admin, create an administrator, delete a user, issue a reset
// link, reset someone's two-step sign-in, server backup): their own password
// and, when they have an authenticator, a current authenticator or unused
// recovery code. The server decides; these rules only shape the form.

import { t, type MessageKey } from '$lib/i18n';

export interface Reauth {
	currentPassword: string;
	code?: string;
}

/**
 * Whether to ask for a code: the administrator has an authenticator, or the
 * server already answered code_invalid (a stale copy of the signed-in user,
 * e.g. an authenticator added in another tab, can still finish).
 */
export function reauthNeedsCode(hasTotp: boolean | undefined, sawCodeInvalid: boolean): boolean {
	return !!hasTotp || sawCodeInvalid;
}

export function reauthReady(password: string, needsCode: boolean, code: string): boolean {
	return password !== '' && (!needsCode || code.trim() !== '');
}

export function reauthBody(password: string, needsCode: boolean, code: string): Reauth {
	const c = code.trim();
	return needsCode && c ? { currentPassword: password, code: c } : { currentPassword: password };
}

export function reauthErrorFallback(): string {
	return t('admin.reauth.error.fallback');
}

// Fixed sentences, never the server's message.
const TEXT: Record<string, MessageKey> = {
	wrong_password: 'admin.reauth.error.wrongPassword',
	password_required: 'admin.reauth.error.passwordRequired',
	code_invalid: 'admin.reauth.error.codeInvalid',
	rate_limited: 'admin.reauth.error.rateLimited',
	busy: 'admin.reauth.error.busy'
};

/** The sentence for a re-authentication refusal, else `fallback`. */
export function reauthError(code: string | undefined, fallback = reauthErrorFallback()): string {
	return code && Object.hasOwn(TEXT, code) ? t(TEXT[code]) : fallback;
}

/** After a refusal: which field takes focus, and which one is cleared. */
export function reauthFocus(code: string | undefined): { focus: 'password' | 'code'; clear: 'password' | 'code' | null } {
	if (code === 'code_invalid') return { focus: 'code', clear: 'code' };
	if (code === 'wrong_password') return { focus: 'password', clear: 'password' };
	return { focus: 'password', clear: null };
}
