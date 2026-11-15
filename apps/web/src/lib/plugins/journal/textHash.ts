// FNV-1a 64 over the UTF-8 bytes, the same as journal.TextHash in Go.
// crypto.subtle is missing on plain-HTTP LAN installs, and the hash only
// detects edits, so a plain hash is enough.

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function textHash(text: string): string {
	let hash = OFFSET;
	for (const byte of new TextEncoder().encode(text)) {
		hash = ((hash ^ BigInt(byte)) * PRIME) & MASK;
	}
	return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
