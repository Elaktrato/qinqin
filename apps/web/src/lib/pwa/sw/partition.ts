// Per-credential API cache partitions. Shared by the worker and the page so
// both name a partition the same way. The name is a hash of the request's own
// Authorization header: the worker never learns an identity, and a different
// token (another user, or the same user after a new login) can only ever find
// an empty partition.

/** Every API cache name of every generation starts with this. */
export const API_CACHE_FAMILY = 'qinqin-api-v';
/** The current generation's prefix; the partition suffix follows. */
export const API_CACHE_PREFIX = 'qinqin-api-v1-';

export interface SubtleDigest {
	digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
}

/** partitionName: `qinqin-api-v1-` + the first 32 hex digits of SHA-256(Authorization). */
export async function partitionName(
	authorization: string,
	subtle: SubtleDigest = globalThis.crypto.subtle
): Promise<string> {
	const bytes = new TextEncoder().encode(authorization);
	const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
	let hex = '';
	for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
	return API_CACHE_PREFIX + hex.slice(0, 32);
}
