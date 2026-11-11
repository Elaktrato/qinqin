// ULID generation for study events: the server keys events on a
// client-generated ULID, so ids must be valid Crockford base32 and
// sort by their generation time.

// Crockford's base32 alphabet: no I, L, O or U, so ids survive being
// read aloud, copied and case-folded.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 26 characters: 10 for the 48-bit millisecond timestamp, 16 for the
// 80-bit random suffix.
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const TIME_MAX = 2 ** 48 - 1;

function encodeTime(now: number): string {
	// ULIDs mask the timestamp to 48 bits; `%` (not `&`) because
	// bitwise operators truncate to 32 bits in JavaScript.
	const time = Math.max(0, Math.floor(now)) % (TIME_MAX + 1);
	if (!Number.isFinite(time)) {
		throw new RangeError('newUlid: timestamp must be a finite number');
	}
	let out = '';
	let rest = time;
	for (let i = 0; i < TIME_LENGTH; i++) {
		// Big-endian: the highest-order digit leads, so ids sort
		// lexicographically in timestamp order.
		out = ENCODING[rest % 32] + out;
		rest = Math.floor(rest / 32);
	}
	return out;
}

function randomBytes(): Uint8Array {
	const bytes = new Uint8Array(RANDOM_LENGTH);
	if (typeof globalThis.crypto?.getRandomValues === 'function') {
		globalThis.crypto.getRandomValues(bytes);
	} else {
		// Non-crypto fallback for exotic runtimes: ULIDs only need
		// uniqueness, not unpredictability.
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	return bytes;
}

function encodeRandom(): string {
	const bytes = randomBytes();
	let out = '';
	for (let i = 0; i < RANDOM_LENGTH; i++) {
		// 256 is a multiple of 32, so taking a byte modulo 32 is
		// unbiased.
		out += ENCODING[bytes[i] % 32];
	}
	return out;
}

/**
 * newUlid returns a 26-character Crockford base32 ULID. The first ten
 * characters encode `now` (milliseconds since the epoch) and therefore
 * sort lexicographically; the last sixteen are random. Two ids made in
 * the same millisecond sort arbitrarily but never collide in practice.
 */
export function newUlid(now: number = Date.now()): string {
	return encodeTime(now) + encodeRandom();
}
