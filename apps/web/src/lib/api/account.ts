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
