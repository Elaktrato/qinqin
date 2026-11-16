// Personal access tokens (docs/contracts/auth/tokens.json). Every route
// needs a signed-in session; an access token is refused on them. The token
// string of create is shown once and never stored by the app.
import { api } from './client';
import type { TokenDto } from '$lib/account/tokensView';

export interface CreateTokenBody {
	name: string;
	scope: 'read' | 'write';
	workspaceId: number | null;
	expiresInDays: number;
	currentPassword: string;
}

export function createToken(body: CreateTokenBody): Promise<{ token: string; accessToken: TokenDto }> {
	return api('/api/account/tokens', { method: 'POST', body });
}

export async function listTokens(): Promise<TokenDto[]> {
	const out = await api<{ accessTokens: TokenDto[] }>('/api/account/tokens');
	return Array.isArray(out?.accessTokens) ? out.accessTokens : [];
}

export function revokeToken(id: number): Promise<void> {
	return api(`/api/account/tokens/${id}`, { method: 'DELETE' });
}

export function revokeAllTokens(): Promise<{ revoked: number }> {
	return api('/api/account/tokens', { method: 'DELETE' });
}
