import { api } from './client';
import type { Language } from './types';

/** listLanguages returns every known language; `installed` marks those with dictionary data. */
export function listLanguages(): Promise<Language[]> {
	return api<Language[]>('/api/languages');
}
