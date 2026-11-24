import { api } from './client';
import type { SessionDto } from '$lib/account/sessionsView';
import type { LoginBody } from './mfa';

export interface ChangePasswordBody {
	currentPassword?: string;
	newPassword: string;
	signOutOthers: boolean;
}

export function changePassword(body: ChangePasswordBody): Promise<{ status: 'ok' }> {
	return api('/api/account/password', { method: 'POST', body });
}

export async function listSessions(): Promise<SessionDto[]> {
	const out = await api<{ sessions: SessionDto[] }>('/api/account/sessions');
	return Array.isArray(out?.sessions) ? out.sessions : [];
}

export function revokeSession(id: number): Promise<void> {
	return api(`/api/account/sessions/${id}`, { method: 'DELETE' });
}

export function revokeSessions(scope: 'others' | 'all'): Promise<{ revoked: number }> {
	return api('/api/account/sessions/revoke', { method: 'POST', body: { scope } });
}

export interface AuthOptions {
	bootstrap: boolean;
	registration: 'closed' | 'invite' | 'open';
	emailPolicy: 'off' | 'optional' | 'required';
	passwordReset: boolean;
	emailCodeLogin: boolean;
	passwordMinLength: number;
	/** False when the server has no usable QINQIN_SECRET: authenticator apps cannot be set up. */
	totpAvailable?: boolean;
	/** Effective: two-step sign-in is required of everyone (false while mail is not set up). */
	mfaEnforced?: boolean;
}

/** The public instance switches the sign-in pages need before anyone is signed in. */
export function getAuthOptions(): Promise<AuthOptions> {
	return api('/api/auth/options', { auth: false });
}

export function checkInvite(invite: string): Promise<{ expiresAt: string | null; emailPolicy: AuthOptions['emailPolicy'] }> {
	return api('/api/auth/invite/check', { method: 'POST', body: { invite }, auth: false });
}

export function checkReset(token: string): Promise<{ username: string; expiresAt: string }> {
	return api('/api/auth/reset/check', { method: 'POST', body: { token }, auth: false });
}

export function useReset(token: string, password: string): Promise<LoginBody> {
	return api('/api/auth/reset', { method: 'POST', body: { token, password }, auth: false });
}

export interface PutEmailResult {
	email: string | null;
	emailVerified: boolean;
	/** `sent`: a code was mailed; `unavailable`: no mail server; `none`: nothing to verify. */
	verification: 'sent' | 'unavailable' | 'none';
}

/** An enrolment session sends no password (the server skips it there). */
/** `code`: the authenticator or recovery code, for accounts that have an authenticator. */
export function putEmail(email: string | null, currentPassword?: string, code?: string): Promise<PutEmailResult> {
	return api('/api/account/email', { method: 'PUT', body: { email, ...(currentPassword ? { currentPassword } : {}), ...(code ? { code } : {}) } });
}

export interface SelfDeletionPreview {
	workspaces: number;
	studyEvents: number;
	pluginData: number;
	/** Live flashcards (typed study rows; absent from servers before v0.4.0). */
	cards?: number;
	books: number;
	/** Journal entries (typed storage since #199). */
	journalEntries?: number;
	journalPhotos: number;
	aiKeys: number;
	sessions: number;
	overlays: number;
	sentences: number;
	/** Personal access tokens (absent from servers before #83). */
	accessTokens?: number;
}

export function accountDeletionPreview(): Promise<SelfDeletionPreview> {
	return api('/api/account/deletion-preview');
}

export function deleteAccount(password: string, confirm: string, code?: string): Promise<void> {
	return api('/api/account', { method: 'DELETE', body: { password, confirm, ...(code ? { code } : {}) } });
}
