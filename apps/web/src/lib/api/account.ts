import { api } from './client';
import type { SessionDto } from '$lib/account/sessionsView';

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

export function useReset(token: string, password: string): Promise<{ status: string; token: string }> {
	return api('/api/auth/reset', { method: 'POST', body: { token, password }, auth: false });
}
