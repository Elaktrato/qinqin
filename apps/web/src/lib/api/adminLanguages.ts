import { api } from './client';
import type { Language } from './types';

/** registerLanguage adds a data-only language by code (admin); the server normalizes the code. */
export function registerLanguage(code: string): Promise<Language> {
	return api<Language>('/api/admin/languages', { method: 'POST', body: { code } });
}

/** removeLanguage deletes an unused data-only language by its stored code (admin). */
export async function removeLanguage(code: string): Promise<void> {
	await api(`/api/admin/languages/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

/** languageUsage counts the workspaces of all users per language (admin). */
export function languageUsage(): Promise<{ code: string; workspaces: number }[]> {
	return api<{ code: string; workspaces: number }[]>('/api/admin/languages/usage');
}
