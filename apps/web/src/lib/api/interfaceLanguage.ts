// The account's interface language (PUT /api/me/interface-language; docs/contracts/i18n/interface-language-api.json).
// GET /api/auth/me carries it as `interfaceLanguage` ('' = follow the browser).
import { api } from './client';

export function putInterfaceLanguage(language: string): Promise<{ language: string }> {
	return api<{ language: string }>('/api/me/interface-language', { method: 'PUT', body: { language } });
}
