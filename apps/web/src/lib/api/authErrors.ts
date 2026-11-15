import { ApiError, apiErrorBody } from '$lib/api/client';

const WRONG = 'Wrong username or password.';
const TAKEN = 'That username is already taken.';
const ADMIN_ONLY = 'Only an administrator can create more accounts.';

/** "6 seconds", "1 minute", "15 minutes": whole units, rounded up like the server. */
export function waitText(seconds: number): string {
	const s = Math.max(1, Math.ceil(seconds));
	const unit = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
	return s < 60 ? unit(s, 'second') : unit(Math.ceil(s / 60), 'minute');
}

/**
 * The text a sign-in or registration failure shows. Reads the server's
 * `{error, message}` body and Retry-After; an older server's plain-text
 * body falls back to the status.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
	const body = apiErrorBody(err);
	if (body) {
		switch (body.error) {
			case 'bad_credentials':
				return WRONG;
			case 'username_taken':
				return TAKEN;
			case 'admin_required':
				return ADMIN_ONLY;
			case 'rate_limited':
				if (err instanceof ApiError && err.retryAfterSeconds !== undefined) {
					return `Too many sign-in attempts. Try again in ${waitText(err.retryAfterSeconds)}.`;
				}
				return body.message || fallback;
			default:
				return body.message || fallback;
		}
	}
	if (err instanceof ApiError) {
		if (err.status === 401) return WRONG;
		if (err.status === 409) return TAKEN;
		if (err.status === 403) return ADMIN_ONLY;
		return err.message || fallback;
	}
	return err instanceof Error && err.message ? err.message : fallback;
}
