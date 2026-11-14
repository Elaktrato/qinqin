import { ApiError } from '$lib/api/client';

/**
 * errorMessage is the text a widget (or the home layout editor) shows for
 * a failed load or save: the server's or the error's message, else `fallback`.
 */
export function errorMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.message) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}
