// Links carry their secret in the URL fragment (`/register#invite=…`,
// `/reset#t=…`): a fragment is never sent to the server, so the token stays
// out of access logs and referrers. The page reads it once and strips it.

export interface FragmentRead {
	/** The value of the key, or null when absent or empty. */
	value: string | null;
	/** The current location without the fragment, for `history.replaceState`. */
	cleaned: string;
}

/**
 * readFragment reads `key` from a `location.hash` and returns the URL to
 * replace the location with (path and search, no fragment).
 */
export function readFragment(hash: string, key: string, pathAndSearch: string): FragmentRead {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	const value = new URLSearchParams(raw).get(key);
	return { value: value && value.length > 0 ? value : null, cleaned: pathAndSearch };
}
