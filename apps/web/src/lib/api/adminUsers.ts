import { api } from './client';
import type { Reauth } from '$lib/admin/reauth';

export interface AdminUserDto {
	id: number;
	username: string;
	email: string | null;
	emailVerified: boolean;
	admin: boolean;
	disabled: boolean;
	mustChangePassword: boolean;
	createdAt: string;
	lastSeenAt: string | null;
	/** Which second steps the user has (never a secret); absent from servers before v0.3.0. */
	mfa?: { totp: boolean; email: boolean };
}

export interface DeletionPreview {
	workspaces: number;
	studyEvents: number;
	pluginData: number;
	books: number;
	journalPhotos: number;
	aiKeys: number;
	sessions: number;
	overlays: number;
	sentences: number;
	/** Personal access tokens (absent from servers before #83). */
	accessTokens?: number;
}

export async function listUsers(): Promise<AdminUserDto[]> {
	const out = await api<{ users: AdminUserDto[] }>('/api/admin/users');
	return Array.isArray(out?.users) ? out.users : [];
}

export function createUser(body: {
	username: string;
	password: string;
	email?: string;
	admin: boolean;
	/** Creating an administrator: the acting administrator's own password (and code). */
	currentPassword?: string;
	code?: string;
}): Promise<AdminUserDto> {
	return api('/api/admin/users', { method: 'POST', body });
}

export function patchUser(
	id: number,
	body: {
		admin?: boolean;
		disabled?: boolean;
		mustChangePassword?: true;
		email?: string | null;
		/** The acting administrator's own password (and code); needed to grant admin. */
		currentPassword?: string;
		code?: string;
	}
): Promise<AdminUserDto> {
	return api(`/api/admin/users/${id}`, { method: 'PATCH', body });
}

export function revokeUserSessions(id: number): Promise<{ revoked: number }> {
	return api(`/api/admin/users/${id}/sessions/revoke`, { method: 'POST', body: {} });
}

export function issueResetLink(
	id: number,
	reauth: Reauth,
	expiresInHours?: number
): Promise<{ path: string; expiresAt: string }> {
	return api(`/api/admin/users/${id}/reset-link`, {
		method: 'POST',
		body: expiresInHours === undefined ? { ...reauth } : { ...reauth, expiresInHours }
	});
}

export function revokeResetLink(id: number): Promise<void> {
	return api(`/api/admin/users/${id}/reset-link`, { method: 'DELETE' });
}

export function deletionPreview(id: number): Promise<DeletionPreview> {
	return api(`/api/admin/users/${id}/deletion-preview`);
}

export function deleteUser(id: number, confirm: string, reauth: Reauth): Promise<void> {
	return api(`/api/admin/users/${id}`, { method: 'DELETE', body: { confirm, ...reauth } });
}

/**
 * resetUserMfa removes another user's second steps and signs them out
 * everywhere, confirmed with the acting administrator's own password and,
 * when they have an authenticator, their code.
 */
export function resetUserMfa(id: number, reauth: Reauth): Promise<void> {
	return api(`/api/admin/users/${id}/mfa/reset`, { method: 'POST', body: { ...reauth } });
}
