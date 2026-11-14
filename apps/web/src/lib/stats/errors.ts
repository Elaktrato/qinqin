import { ApiError } from '$lib/api/client';

/** errorMessage is the text a widget shows for a failed load. */
export function errorMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.message) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}
