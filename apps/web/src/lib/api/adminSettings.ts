import { api } from './client';

export type Registration = 'closed' | 'invite' | 'open';
export type EmailPolicy = 'off' | 'optional' | 'required';

export interface AuthSettings {
	registration: Registration;
	emailPolicy: EmailPolicy;
	mfaEnforced: boolean;
	/** False while no mail server is configured: enforcement is inactive then. */
	mfaEnforcedEffective?: boolean;
	emailCodeLogin: boolean;
	mail: { configured: boolean };
}

export function getAuthSettings(): Promise<AuthSettings> {
	return api('/api/admin/settings/auth');
}

export function patchAuthSettings(
	patch: Partial<Pick<AuthSettings, 'registration' | 'emailPolicy' | 'mfaEnforced' | 'emailCodeLogin'>> & { signOutOthers?: boolean }
): Promise<AuthSettings> {
	return api('/api/admin/settings/auth', { method: 'PATCH', body: patch });
}

export interface AuditEvent {
	id: number;
	at: string;
	action: string;
	actor: { id: number; name: string } | null;
	target: { id: number; name: string } | null;
	detail: Record<string, unknown>;
}

export function listAudit(before?: number, limit = 50): Promise<{ events: AuditEvent[]; next: number | null }> {
	const q = new URLSearchParams({ limit: String(limit) });
	if (before !== undefined) q.set('before', String(before));
	return api(`/api/admin/audit?${q}`);
}

export interface InviteDto {
	id: number;
	note: string;
	maxUses: number;
	uses: number;
	expiresAt: string | null;
	createdAt: string;
	createdBy: { id: number; name: string };
	state: 'active' | 'expired' | 'used_up' | 'revoked' | 'inactive';
}

export async function listInvites(): Promise<InviteDto[]> {
	const out = await api<{ invites: InviteDto[] }>('/api/admin/invites');
	return Array.isArray(out?.invites) ? out.invites : [];
}

export function createInvite(body: {
	maxUses: number;
	expiresInDays: number | null;
	note: string;
}): Promise<{ invite: InviteDto; token: string; path: string }> {
	return api('/api/admin/invites', { method: 'POST', body });
}

export function revokeInvite(id: number): Promise<void> {
	return api(`/api/admin/invites/${id}`, { method: 'DELETE' });
}

export interface SmtpSettings {
	configured: boolean;
	host: string;
	port: number;
	tls: 'starttls' | 'tls' | 'none';
	username: string;
	/** Never the password: whether one is saved. */
	password: 'set' | 'none' | 'undecryptable';
	fromAddress: string;
	fromName: string;
	publicUrl: string;
	secret: 'ok' | 'missing' | 'invalid';
	allowPrivate: boolean;
	updatedAt: string;
	/** Users whose only second step is an emailed code: they cannot sign in while mail is down. */
	usersDependOnMail?: number;
}

export interface SmtpPayload {
	host: string;
	port: number;
	tls: string;
	username: string;
	/** Absent keeps the saved password, "" removes it, a string replaces it. */
	password?: string;
	fromAddress: string;
	fromName: string;
	publicUrl: string;
}

export const getSmtp = (): Promise<SmtpSettings> => api('/api/admin/settings/smtp');
export const putSmtp = (body: SmtpPayload): Promise<SmtpSettings> => api('/api/admin/settings/smtp', { method: 'PUT', body });
export const deleteSmtp = (): Promise<void> => api('/api/admin/settings/smtp', { method: 'DELETE' });
export const testSmtp = (body: { to?: string; draft?: SmtpPayload }): Promise<{ sent: boolean }> =>
	api('/api/admin/settings/smtp/test', { method: 'POST', body });
