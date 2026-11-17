import { API_ERROR_KEYS } from '$lib/api/apiErrors';
import { ApiError, apiErrorBody } from '$lib/api/client';
import { t } from '$lib/i18n';

/**
 * errorMessage is the text a widget (or the home layout editor) shows for
 * a failed load or save: a coded JSON error by its catalogue text (an unknown
 * code: `fallback`, never the server's English message); an uncoded refusal
 * as the server's plain text; else the error's message, else `fallback`.
 */
export function errorMessage(err: unknown, fallback: string): string {
	const code = apiErrorBody(err)?.error;
	if (code !== undefined) return Object.hasOwn(API_ERROR_KEYS, code) ? t(API_ERROR_KEYS[code]) : fallback;
	if (err instanceof ApiError && err.message) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}
