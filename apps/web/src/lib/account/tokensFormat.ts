// Personal access token format (docs/contracts/auth/tokens-format.json):
// "qq_pat_" + 64 lowercase hex characters. The server stores only the
// SHA-256 of the whole string and the hint (the 6 hex characters after the
// prefix); a token is shown once, on create.

export const TOKEN_PREFIX = 'qq_pat_';
export const TOKEN_RE = /^qq_pat_[0-9a-f]{64}$/;

/** True when s is exactly a well-formed access token. */
export function isTokenShaped(s: string): boolean {
	return TOKEN_RE.test(s);
}

/** The 6 hex characters after the prefix, or '' for a malformed string. */
export function tokenHint(s: string): string {
	return isTokenShaped(s) ? s.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 6) : '';
}
