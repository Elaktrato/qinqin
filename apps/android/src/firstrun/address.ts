// The server address of the first-run screen: pure functions, no DOM, no Capacitor (address.test.ts).
//
// Rules (docs/superpowers/plans/2026-11-25-android-shell.md, Rulings):
// - https is required; plain http only for a private address (the person's own network);
// - the web app lives at the root of its origin (its API paths are absolute), so only the origin is kept:
//   a pasted page address loses its path, query and fragment;
// - no credentials in the address.

export type AddressProblem = 'empty' | 'invalid' | 'scheme' | 'credentials' | 'insecurePublic';

export type AddressResult =
	| {
			ok: true;
			/** The origin to store and open: scheme://host[:port], no trailing slash. */
			url: string;
			/** True for http: the screen shows a warning. */
			cleartext: boolean;
			/** True when the input had a path, query or fragment that was dropped (the screen says so). */
			droppedPath: boolean;
	  }
	| { ok: false; reason: AddressProblem };

function ipv4(host: string): number[] | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return null;
	const parts = m.slice(1).map(Number);
	return parts.every((n) => n <= 255) ? parts : null;
}

/**
 * isPrivateHost: whether plain http may be used for this host (as URL.hostname writes it: IPv6 in brackets).
 * localhost, *.localhost, *.local, a single-label name (a home network name such as `nas`), 127/8, 10/8,
 * 172.16/12, 192.168/16, 169.254/16 (link-local; 10.0.2.2, the emulator's host, is in 10/8), and IPv6 ::1,
 * fc00::/7 and fe80::/10. Not 100.64/10 (carrier-grade NAT).
 */
export function isPrivateHost(host: string): boolean {
	const h = host.toLowerCase().replace(/\.$/, '');
	if (h.startsWith('[') && h.endsWith(']')) {
		const v6 = h.slice(1, -1);
		if (v6 === '::1') return true;
		const first = v6.split(':')[0];
		if (first === '') return false;
		const n = parseInt(first, 16);
		return (n >= 0xfc00 && n <= 0xfdff) || (n >= 0xfe80 && n <= 0xfebf);
	}
	const v4 = ipv4(h);
	if (v4) {
		const [a, b] = v4;
		return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
	}
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
	return !h.includes('.');
}

/**
 * Whether `host` is one the native side (java.net.URI) will accept: IPv6 in brackets, an IPv4 address, or dotted
 * labels of letters, digits and inner hyphens whose last label starts with a letter. URL() is more lenient
 * (an underscore passes), and a host Java rejects would be saved on this screen and then refused by the shell.
 */
function isNativeHost(host: string): boolean {
	if (host.startsWith('[')) return true;
	if (ipv4(host)) return true;
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host)) return false;
	return /^[a-z]/i.test(host.slice(host.lastIndexOf('.') + 1));
}

/** normalizeAddress turns what a person typed into the address to verify, or says why it cannot be one. */
export function normalizeAddress(input: string): AddressResult {
	const text = input.trim();
	if (text === '') return { ok: false, reason: 'empty' };
	if (/\s/.test(text)) return { ok: false, reason: 'invalid' };
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
	let u: URL;
	try {
		u = new URL(withScheme);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'scheme' };
	if (u.username !== '' || u.password !== '') return { ok: false, reason: 'credentials' };
	const host = u.hostname.replace(/\.$/, '');
	if (host === '' || !isNativeHost(host)) return { ok: false, reason: 'invalid' };
	const cleartext = u.protocol === 'http:';
	if (cleartext && !isPrivateHost(host)) return { ok: false, reason: 'insecurePublic' };
	const port = u.port === '' ? '' : `:${u.port}`;
	const droppedPath = (u.pathname !== '/' && u.pathname !== '') || u.search !== '' || u.hash !== '';
	return { ok: true, url: `${u.protocol}//${host}${port}`, cleartext, droppedPath };
}
