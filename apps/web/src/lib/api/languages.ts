import { api } from './client';
import type { Language } from './types';

/** listLanguages returns the languages with installed dictionary data. */
export function listLanguages(): Promise<Language[]> {
	return api<Language[]>('/api/languages');
}
