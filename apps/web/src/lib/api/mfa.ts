// Two-step sign-in, sign-in codes, email verification and two-factor setup.
// Every route here answers {error, message} on failure (docs/contracts/auth).

import { api } from './client';

/** A login-shaped answer: a session (`token`), or `mfa_required` with a challenge. */
export interface LoginBody {
	status: string;
	token?: string;
	challenge?: string;
	methods?: string[];
	emailHint?: string | null;
	expiresAt?: string;
}

export function mfaStep(challenge: string, method: string, code: string): Promise<LoginBody> {
	return api('/api/auth/login/mfa', { method: 'POST', body: { challenge, method, code }, auth: false });
}

export function mfaSendEmail(challenge: string): Promise<{ resendAfter: number }> {
	return api('/api/auth/login/mfa/email', { method: 'POST', body: { challenge }, auth: false });
}

export interface EmailLoginStarted {
	challenge: string;
	resendAfter: number;
	expiresAt: string;
}

export function emailLoginStart(login: string): Promise<EmailLoginStarted> {
	return api('/api/auth/email-login/start', { method: 'POST', body: { login }, auth: false });
}

export function emailLoginVerify(challenge: string, code: string): Promise<LoginBody> {
	return api('/api/auth/email-login/verify', { method: 'POST', body: { challenge, code }, auth: false });
}

/** Always 202 for a known or unknown account; 409 mail_unavailable when mail is not set up. */
export function resetRequest(login: string): Promise<Record<string, never>> {
	return api('/api/auth/reset-request', { method: 'POST', body: { login }, auth: false });
}

export interface TotpSetup {
	secret: string;
	otpauthUri: string;
	expiresAt: string;
}

export function totpSetup(body: { password?: string; code?: string }): Promise<TotpSetup> {
	return api('/api/account/mfa/totp/setup', { method: 'POST', body });
}

export function totpConfirm(code: string): Promise<{ recoveryCodes: string[] }> {
	return api('/api/account/mfa/totp/confirm', { method: 'POST', body: { code } });
}

export function totpDisable(password: string, code: string): Promise<void> {
	return api('/api/account/mfa/totp', { method: 'DELETE', body: { password, code } });
}

export function newRecoveryCodes(password: string, code: string): Promise<{ recoveryCodes: string[] }> {
	return api('/api/account/mfa/recovery-codes', { method: 'POST', body: { password, code } });
}

export function setEmailMethod(enabled: boolean, password?: string): Promise<{ email: boolean }> {
	return api('/api/account/mfa/email', { method: 'POST', body: { enabled, ...(password ? { password } : {}) } });
}

export function verifyEmailCode(code: string): Promise<{ emailVerified: boolean }> {
	return api('/api/account/email/verify', { method: 'POST', body: { code } });
}

export function resendEmailCode(): Promise<{ resendAfter: number }> {
	return api('/api/account/email/resend', { method: 'POST', body: {} });
}
