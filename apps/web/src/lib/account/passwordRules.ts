// Client mirror of the server's password policy (server/internal/auth/policy.go):
// 10 to 256 characters, not the username in any letter case, no composition
// rules. The server decides; this only gives inline feedback.

import { t } from '$lib/i18n';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 256;

export function passwordHint(): string {
	return t('account.password.hint', { min: MIN_PASSWORD });
}

/** The sentence for a password the policy rejects, or null when it passes. */
export function passwordProblem(username: string, password: string): string | null {
	const length = [...password].length;
	if (length < MIN_PASSWORD) return t('account.password.tooShort', { min: MIN_PASSWORD });
	if (length > MAX_PASSWORD) return t('account.password.tooLong', { max: MAX_PASSWORD });
	if (password.toLowerCase() === username.toLowerCase()) {
		return t('account.password.sameAsUser');
	}
	return null;
}

/** The sentence for a confirmation that differs; silent until one is typed. */
export function confirmProblem(password: string, confirm: string): string | null {
	if (confirm === '') return null;
	return password === confirm ? null : t('account.password.mismatch');
}
