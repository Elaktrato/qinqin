import { api } from './client';

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
}): Promise<AdminUserDto> {
	return api('/api/admin/users', { method: 'POST', body });
}

export function patchUser(
	id: number,
	body: { admin?: boolean; disabled?: boolean; mustChangePassword?: true; email?: string | null }
): Promise<AdminUserDto> {
	return api(`/api/admin/users/${id}`, { method: 'PATCH', body });
}

export function revokeUserSessions(id: number): Promise<{ revoked: number }> {
	return api(`/api/admin/users/${id}/sessions/revoke`, { method: 'POST', body: {} });
}

export function issueResetLink(id: number, expiresInHours?: number): Promise<{ path: string; expiresAt: string }> {
	return api(`/api/admin/users/${id}/reset-link`, {
		method: 'POST',
		body: expiresInHours === undefined ? {} : { expiresInHours }
	});
}

export function deletionPreview(id: number): Promise<DeletionPreview> {
	return api(`/api/admin/users/${id}/deletion-preview`);
}

export function deleteUser(id: number, confirm: string): Promise<void> {
	return api(`/api/admin/users/${id}`, { method: 'DELETE', body: { confirm } });
}
